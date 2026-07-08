import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { AuditLogger, AuditUnavailableError } from '../src/audit.js';
import {
  FileEditConflictError,
  FileToolError,
  FileToolService,
  createFileToolDispatcher,
} from '../src/tools/files.js';

async function tempRoot(): Promise<string> {
  return realpath(await mkdtemp(path.join(tmpdir(), 'loom-files-')));
}

async function setupService() {
  const root = await tempRoot();
  const auditDirectory = path.join(root, 'audit');
  await mkdir(auditDirectory, { mode: 0o700 });
  const audit = await AuditLogger.create({
    auditDirectory,
    now: () => new Date('2026-07-08T08:00:00.000Z'),
  });
  return {
    root,
    auditDirectory,
    audit,
    service: new FileToolService({ audit }),
  };
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function textContent(result: Awaited<ReturnType<FileToolService['read']>>): string {
  const item = result.content[0];
  assert.ok(item && item.type === 'text');
  return item.text;
}

async function auditRecords(auditDirectory: string): Promise<Record<string, unknown>[]> {
  const records: Record<string, unknown>[] = [];
  for (const name of (await readdir(auditDirectory)).filter((entry) => entry.endsWith('.jsonl')).sort()) {
    const raw = await readFile(path.join(auditDirectory, name), 'utf8');
    for (const line of raw.split('\n').filter(Boolean)) {
      records.push(JSON.parse(line) as Record<string, unknown>);
    }
  }
  return records;
}

test('loom_read returns UTF-8 text, a stable full-file hash, and exact byte-range metadata', async (t) => {
  const { root, audit, service } = await setupService();
  t.after(() => audit.close());
  const target = path.join(root, 'text.txt');
  await writeFile(target, 'abcdefghij');

  const full = await service.read({ path: target });
  assert.equal(textContent(full), 'abcdefghij');
  assert.deepEqual(full.structuredContent, {
    path: target,
    kind: 'text',
    mimeType: 'text/plain; charset=utf-8',
    encoding: 'utf8',
    sha256: sha256('abcdefghij'),
    fileBytes: 10,
    offset: 0,
    returnedBytes: 10,
    nextOffset: null,
    truncated: false,
  });

  const ranged = await service.read({ path: target, offset: 2, length: 4 });
  assert.equal(textContent(ranged), 'cdef');
  assert.deepEqual(ranged.structuredContent, {
    path: target,
    kind: 'text',
    mimeType: 'text/plain; charset=utf-8',
    encoding: 'utf8',
    sha256: sha256('abcdefghij'),
    fileBytes: 10,
    offset: 2,
    returnedBytes: 4,
    nextOffset: 6,
    truncated: true,
  });
});

test('loom_read detects PNG, JPEG, GIF, and WebP by magic bytes rather than extension', async (t) => {
  const { root, audit, service } = await setupService();
  t.after(() => audit.close());
  const fixtures = [
    ['png.bin', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]), 'image/png'],
    ['jpeg.bin', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1]), 'image/jpeg'],
    ['gif.bin', Buffer.from('GIF89aimage'), 'image/gif'],
    ['webp.bin', Buffer.concat([Buffer.from('RIFF'), Buffer.from([4, 0, 0, 0]), Buffer.from('WEBPdata')]), 'image/webp'],
  ] as const;

  for (const [name, bytes, mimeType] of fixtures) {
    const target = path.join(root, name);
    await writeFile(target, bytes);
    const result = await service.read({ path: target });
    const item = result.content[0];
    assert.ok(item && item.type === 'image');
    assert.equal(item.mimeType, mimeType);
    assert.equal(item.data, bytes.toString('base64'));
    assert.equal(result.structuredContent?.kind, 'image');
    assert.equal(result.structuredContent?.mimeType, mimeType);
    assert.equal(result.structuredContent?.sha256, sha256(bytes));
  }
});

test('loom_read rejects unsupported binary by default, allows explicit base64, and enforces size limits', async (t) => {
  const { root, audit, service } = await setupService();
  t.after(() => audit.close());
  const binaryPath = path.join(root, 'binary.dat');
  const binary = Buffer.from([0xff, 0x00, 0xfe]);
  await writeFile(binaryPath, binary);

  await assert.rejects(service.read({ path: binaryPath }), FileToolError);
  const encoded = await service.read({ path: binaryPath, encoding: 'base64' });
  assert.equal(textContent(encoded), binary.toString('base64'));
  assert.equal(encoded.structuredContent?.kind, 'binary');
  assert.equal(encoded.structuredContent?.encoding, 'base64');

  const oversizedImage = path.join(root, 'large-image.bin');
  await writeFile(
    oversizedImage,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(2 * 1024 * 1024),
    ]),
  );
  await assert.rejects(service.read({ path: oversizedImage }), FileToolError);

  const oversizedText = path.join(root, 'large.txt');
  await writeFile(oversizedText, Buffer.alloc(8 * 1024 * 1024 + 1, 0x61));
  await assert.rejects(service.read({ path: oversizedText }), FileToolError);
});

test('file tools reject relative paths at their public error boundary', async (t) => {
  const { audit, service } = await setupService();
  t.after(() => audit.close());

  await assert.rejects(service.read({ path: 'relative.txt' }), FileToolError);
  await assert.rejects(
    service.write({ path: 'relative.txt', content: 'unsafe' }),
    FileToolError,
  );
  await assert.rejects(
    service.edit({ path: 'relative.txt', oldText: 'a', newText: 'b' }),
    FileToolError,
  );
});

test('file reads follow a stable final symlink while mutations and parent symlinks remain rejected', async (t) => {
  const { root, audit, service } = await setupService();
  t.after(() => audit.close());
  const realDirectory = path.join(root, 'real');
  await mkdir(realDirectory);
  const realFile = path.join(realDirectory, 'safe.txt');
  await writeFile(realFile, 'safe');
  const linkedFile = path.join(root, 'linked-file');
  const linkedDirectory = path.join(root, 'linked-directory');
  await symlink(realFile, linkedFile);
  await symlink(realDirectory, linkedDirectory);

  const linkedRead = await service.read({ path: linkedFile });
  assert.equal(linkedRead.content[0]?.type, 'text');
  assert.equal(linkedRead.content[0]?.type === 'text' ? linkedRead.content[0].text : null, 'safe');
  await assert.rejects(
    service.read({ path: path.join(linkedDirectory, 'safe.txt') }),
    FileToolError,
  );
  await assert.rejects(
    service.write({ path: path.join(linkedDirectory, 'new.txt'), content: 'unsafe' }),
    FileToolError,
  );
  await assert.rejects(
    service.edit({ path: linkedFile, oldText: 'safe', newText: 'unsafe' }),
    FileToolError,
  );
  assert.equal(await readFile(realFile, 'utf8'), 'safe');
});

test('loom_write is audited before mutation, atomic, private, and supports optimistic conflicts', async (t) => {
  const { root, auditDirectory, audit, service } = await setupService();
  t.after(() => audit.close());
  const target = path.join(root, 'nested', 'written.txt');

  const created = await service.write({
    path: target,
    content: 'first secret body',
    createParents: true,
  });
  assert.equal(await readFile(target, 'utf8'), 'first secret body');
  assert.equal((await stat(path.dirname(target))).mode & 0o777, 0o700);
  assert.equal((await stat(target)).mode & 0o777, 0o600);
  assert.equal(created.structuredContent?.sha256, sha256('first secret body'));

  await assert.rejects(
    service.write({
      path: target,
      content: 'stale replacement',
      expectedSha256: sha256('not current'),
    }),
    FileToolError,
  );
  assert.equal(await readFile(target, 'utf8'), 'first secret body');

  const records = await auditRecords(auditDirectory);
  assert.deepEqual(records.map((record) => record.phase), ['start', 'finish', 'start', 'finish']);
  assert.equal(records[0]!.operation, 'file.write');
  assert.equal(records[1]!.status, 'ok');
  assert.equal(records[3]!.status, 'error');
  const persisted = JSON.stringify(records);
  assert.equal(persisted.includes('first secret body'), false);
  assert.equal(persisted.includes('stale replacement'), false);
});

test('audit failure prevents write and edit mutations from touching the file', async (t) => {
  const { root, auditDirectory, audit, service } = await setupService();
  t.after(() => audit.close());
  const target = path.join(root, 'protected.txt');
  await writeFile(target, 'original');
  await rm(auditDirectory, { recursive: true });

  await assert.rejects(
    service.write({ path: target, content: 'changed' }),
    AuditUnavailableError,
  );
  await assert.rejects(
    service.edit({ path: target, oldText: 'original', newText: 'changed' }),
    AuditUnavailableError,
  );
  assert.equal(await readFile(target, 'utf8'), 'original');
  const readOnly = await service.read({ path: target });
  assert.equal(textContent(readOnly), 'original');
});

test('loom_edit requires exact unambiguous matches unless replaceAll is explicit', async (t) => {
  const { root, audit, service } = await setupService();
  t.after(() => audit.close());
  const target = path.join(root, 'edit.txt');
  await writeFile(target, 'one two one');

  await assert.rejects(
    service.edit({ path: target, oldText: 'one', newText: 'ONE' }),
    FileEditConflictError,
  );
  await assert.rejects(
    service.edit({ path: target, oldText: 'missing', newText: 'value' }),
    FileEditConflictError,
  );
  assert.equal(await readFile(target, 'utf8'), 'one two one');

  const edited = await service.edit({
    path: target,
    oldText: 'one',
    newText: 'ONE',
    replaceAll: true,
    expectedSha256: sha256('one two one'),
  });
  assert.equal(await readFile(target, 'utf8'), 'ONE two ONE');
  assert.equal(edited.structuredContent?.replacements, 2);
  assert.equal(edited.structuredContent?.previousSha256, sha256('one two one'));
  assert.equal(edited.structuredContent?.sha256, sha256('ONE two ONE'));
});

test('concurrent edits sharing one expected hash serialize so exactly one succeeds', async (t) => {
  const { root, audit, service } = await setupService();
  t.after(() => audit.close());
  const target = path.join(root, 'concurrent.txt');
  await writeFile(target, 'base');
  const expectedSha256 = sha256('base');

  const results = await Promise.allSettled([
    service.edit({
      path: target,
      oldText: 'base',
      newText: 'first',
      expectedSha256,
    }),
    service.edit({
      path: target,
      oldText: 'base',
      newText: 'second',
      expectedSha256,
    }),
  ]);

  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const rejected = results.find((result) => result.status === 'rejected');
  assert.ok(rejected && rejected.status === 'rejected');
  assert.ok(rejected.reason instanceof FileEditConflictError);
  assert.match(await readFile(target, 'utf8'), /^(first|second)$/);
});

test('loom_edit detects stale expected hashes and enforces byte limits', async (t) => {
  const { root, audit, service } = await setupService();
  t.after(() => audit.close());
  const target = path.join(root, 'limits.txt');
  await writeFile(target, 'current');

  await assert.rejects(
    service.edit({
      path: target,
      oldText: 'current',
      newText: 'replacement',
      expectedSha256: sha256('stale'),
    }),
    FileEditConflictError,
  );
  await assert.rejects(
    service.edit({
      path: target,
      oldText: 'x'.repeat(256 * 1024 + 1),
      newText: '',
    }),
    FileToolError,
  );
  await assert.rejects(
    service.write({ path: path.join(root, 'too-large.txt'), content: 'x'.repeat(8 * 1024 * 1024 + 1) }),
    FileToolError,
  );
  assert.equal(await readFile(target, 'utf8'), 'current');
});

test('file dispatcher routes read/write/edit and delegates every other Loom tool unchanged', async (t) => {
  const { root, audit, service } = await setupService();
  t.after(() => audit.close());
  const delegated: Array<[string, Record<string, unknown>]> = [];
  const dispatcher = createFileToolDispatcher(service, async (name, arguments_) => {
    delegated.push([name, arguments_]);
    return { content: [{ type: 'text', text: 'delegated' }] };
  });
  const target = path.join(root, 'dispatch.txt');

  await dispatcher('loom_write', { path: target, content: 'through dispatcher' });
  const read = await dispatcher('loom_read', { path: target });
  assert.equal(read.content[0]?.type, 'text');
  await dispatcher('loom_edit', {
    path: target,
    oldText: 'dispatcher',
    newText: 'service',
  });
  assert.equal(await readFile(target, 'utf8'), 'through service');

  const delegatedResult = await dispatcher('loom_skills', { action: 'list' });
  assert.equal(delegatedResult.content[0]?.type, 'text');
  assert.deepEqual(delegated, [['loom_skills', { action: 'list' }]]);
});
