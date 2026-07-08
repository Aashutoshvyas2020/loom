import assert from 'node:assert/strict';
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
  MemoryConflictError,
  MemoryStoreConfigError,
  MemoryStoreLimitError,
  MemoryStoreService,
  createMemoryToolDispatcher,
} from '../src/tools/memory.js';

async function tempRoot(): Promise<string> {
  return realpath(await mkdtemp(path.join(tmpdir(), 'loom-memory-')));
}

async function setupService(options: {
  limits?: ConstructorParameters<typeof MemoryStoreService>[0]['limits'];
} = {}) {
  const root = await tempRoot();
  const memoryDirectory = path.join(root, 'memory');
  const auditDirectory = path.join(root, 'audit');
  await mkdir(memoryDirectory, { mode: 0o700 });
  await mkdir(auditDirectory, { mode: 0o700 });
  const audit = await AuditLogger.create({
    auditDirectory,
    now: () => new Date('2026-07-08T09:00:00.000Z'),
  });
  const service = new MemoryStoreService({
    memoryDirectory,
    audit,
    ...(options.limits === undefined ? {} : { limits: options.limits }),
    now: () => new Date('2026-07-08T09:00:00.000Z'),
  });
  return { root, memoryDirectory, auditDirectory, audit, service };
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

test('save creates a private stable-ID Markdown memory, publishes it, and never audits title/content', async (t) => {
  const { memoryDirectory, auditDirectory, audit, service } = await setupService();
  t.after(() => audit.close());

  const saved = await service.save({
    title: 'Private launch idea',
    content: 'The secret body must never enter audit logs.',
  });
  const id = saved.structuredContent?.id as string;
  assert.match(id, /^mem_[A-Za-z0-9_-]{32}$/);
  const filePath = path.join(memoryDirectory, `${id}.md`);
  assert.equal((await stat(memoryDirectory)).mode & 0o777, 0o700);
  assert.equal((await stat(filePath)).mode & 0o777, 0o600);
  assert.match(await readFile(filePath, 'utf8'), new RegExp(`id: ${id}`));

  const listed = await service.list();
  const memories = listed.structuredContent?.memories as Array<{ id: string; title: string }>;
  assert.deepEqual(memories, [{
    id,
    title: 'Private launch idea',
    createdAt: '2026-07-08T09:00:00.000Z',
    updatedAt: '2026-07-08T09:00:00.000Z',
    contentBytes: 44,
    fileBytes: (saved.structuredContent?.fileBytes as number),
    sha256: saved.structuredContent?.sha256,
  }]);

  const read = await service.read({ id });
  const item = read.content[0];
  assert.ok(item && item.type === 'text');
  assert.equal(item.text, 'The secret body must never enter audit logs.');

  const persistedAudit = JSON.stringify(await auditRecords(auditDirectory));
  assert.equal(persistedAudit.includes('Private launch idea'), false);
  assert.equal(persistedAudit.includes('secret body'), false);
});

test('search ranking is deterministic and favors title over content-only matches', async (t) => {
  const { audit, service } = await setupService();
  t.after(() => audit.close());
  const camera = await service.save({
    title: 'Camera field notes',
    content: 'Lens and exposure observations.',
  });
  const generic = await service.save({
    title: 'General notes',
    content: 'A camera appears once in this body.',
  });
  await service.save({
    title: 'Code review',
    content: 'TypeScript observations.',
  });

  const searched = await service.search({ query: 'camera', limit: 2 });
  const results = searched.structuredContent?.memories as Array<{ id: string; score: number }>;
  assert.deepEqual(results.map((result) => result.id), [
    camera.structuredContent?.id,
    generic.structuredContent?.id,
  ]);
  assert.equal(results[0]!.score > results[1]!.score, true);
});

test('rescan in a new service preserves IDs and content across process-style reopen', async (t) => {
  const { memoryDirectory, audit, service } = await setupService();
  t.after(() => audit.close());
  const saved = await service.save({ title: 'Persistent', content: 'Survives reopen.' });
  const id = saved.structuredContent?.id as string;

  const reopened = new MemoryStoreService({
    memoryDirectory,
    audit,
    now: () => new Date('2026-07-08T10:00:00.000Z'),
  });
  await reopened.rescan();

  assert.deepEqual(
    reopened.getSnapshot().memories.map((memory) => memory.id),
    [id],
  );
  const read = await reopened.read({ id });
  assert.equal(read.content[0]?.type, 'text');
  assert.equal(read.content[0]?.type === 'text' ? read.content[0].text : '', 'Survives reopen.');
});

test('audit failure blocks save and delete before visible memory state changes', async (t) => {
  const { memoryDirectory, auditDirectory, audit, service } = await setupService();
  t.after(() => audit.close());
  const saved = await service.save({ title: 'Keep', content: 'Must remain.' });
  const id = saved.structuredContent?.id as string;
  await rm(auditDirectory, { recursive: true });

  await assert.rejects(
    service.save({ title: 'Blocked', content: 'Must not be created.' }),
    AuditUnavailableError,
  );
  await assert.rejects(service.delete({ id }), AuditUnavailableError);
  assert.deepEqual((await readdir(memoryDirectory)).filter((name) => name.endsWith('.md')), [`${id}.md`]);
  const read = await service.read({ id });
  assert.equal(read.content[0]?.type === 'text' ? read.content[0].text : '', 'Must remain.');
});

test('delete removes the visible file atomically, updates the snapshot, and leaves no tombstone', async (t) => {
  const { memoryDirectory, audit, service } = await setupService();
  t.after(() => audit.close());
  const saved = await service.save({ title: 'Delete me', content: 'Temporary.' });
  const id = saved.structuredContent?.id as string;

  const deleted = await service.delete({ id });

  assert.equal(deleted.structuredContent?.id, id);
  assert.deepEqual(service.getSnapshot().memories, []);
  assert.equal((await readdir(memoryDirectory)).some((name) => name.includes(id)), false);
  await assert.rejects(service.read({ id }), MemoryStoreConfigError);
});

test('delete detects external modification and preserves both file and prior snapshot', async (t) => {
  const { memoryDirectory, audit, service } = await setupService();
  t.after(() => audit.close());
  const saved = await service.save({ title: 'Conflict', content: 'Original.' });
  const id = saved.structuredContent?.id as string;
  const before = service.getSnapshot();
  const filePath = path.join(memoryDirectory, `${id}.md`);
  await writeFile(filePath, `${await readFile(filePath, 'utf8')}external change\n`, { mode: 0o600 });

  await assert.rejects(service.delete({ id }), MemoryConflictError);
  assert.equal((await stat(filePath)).isFile(), true);
  assert.deepEqual(service.getSnapshot(), before);
});

test('concurrent saves serialize without lost updates or ID collisions', async (t) => {
  const { audit, service } = await setupService();
  t.after(() => audit.close());

  const saved = await Promise.all(
    Array.from({ length: 20 }, (_, index) => service.save({
      title: `Memory ${index}`,
      content: `Body ${index}`,
    })),
  );
  const ids = saved.map((result) => result.structuredContent?.id as string);

  assert.equal(new Set(ids).size, 20);
  assert.equal(service.getSnapshot().memories.length, 20);
  assert.deepEqual(
    service.getSnapshot().memories.map((memory) => memory.id),
    [...ids].sort(),
  );
});

test('unsafe symlink and hard resource failures abort rescan without publishing partial state', async (t) => {
  const { memoryDirectory, audit, service } = await setupService({
    limits: { maxFiles: 3, maxFileBytes: 512, maxTotalBytes: 1_024 },
  });
  t.after(() => audit.close());
  const saved = await service.save({ title: 'Safe', content: 'Initial.' });
  const before = service.getSnapshot();
  const external = path.join(await tempRoot(), 'outside.md');
  await writeFile(external, 'outside');
  await symlink(external, path.join(memoryDirectory, 'mem_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.md'));

  await assert.rejects(service.rescan(), MemoryStoreConfigError);
  assert.deepEqual(service.getSnapshot(), before);
  await rm(path.join(memoryDirectory, 'mem_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.md'));

  await writeFile(path.join(memoryDirectory, 'junk-1.txt'), 'junk');
  await writeFile(path.join(memoryDirectory, 'junk-2.txt'), 'junk');
  await writeFile(path.join(memoryDirectory, 'junk-3.txt'), 'junk');
  await assert.rejects(service.rescan(), MemoryStoreLimitError);
  assert.deepEqual(service.getSnapshot(), before);
  assert.equal(saved.structuredContent?.id, before.memories[0]?.id);
});

test('file and aggregate byte limits are enforced without publishing partial rescans', async (t) => {
  const { memoryDirectory, audit, service } = await setupService({
    limits: { maxFileBytes: 512, maxTotalBytes: 600 },
  });
  t.after(() => audit.close());
  const first = await service.save({ title: 'First', content: 'a'.repeat(100) });
  const before = service.getSnapshot();

  await assert.rejects(
    service.save({ title: 'Too large', content: 'x'.repeat(600) }),
    MemoryStoreLimitError,
  );
  assert.deepEqual(service.getSnapshot(), before);

  const writer = new MemoryStoreService({
    memoryDirectory,
    audit,
    now: () => new Date('2026-07-08T11:00:00.000Z'),
  });
  await writer.rescan();
  await writer.save({ title: 'Second', content: 'b'.repeat(250) });

  await assert.rejects(service.rescan(), MemoryStoreLimitError);
  assert.deepEqual(service.getSnapshot(), before);
  assert.equal(first.structuredContent?.id, before.memories[0]?.id);
});

test('a symlinked memory root is rejected before any catalog generation is published', async (t) => {
  const target = await tempRoot();
  const parent = await tempRoot();
  const linked = path.join(parent, 'memory-link');
  await symlink(target, linked);
  const auditDirectory = path.join(parent, 'audit');
  await mkdir(auditDirectory, { mode: 0o700 });
  const audit = await AuditLogger.create({ auditDirectory });
  t.after(() => audit.close());
  const service = new MemoryStoreService({ memoryDirectory: linked, audit });

  await assert.rejects(service.rescan(), MemoryStoreConfigError);
  assert.equal(service.getSnapshot().generation, 0);
  assert.deepEqual(service.getSnapshot().memories, []);
});

test('invalid memory files are diagnosed and stale tombstones are safely recovered', async (t) => {
  const { memoryDirectory, audit, service } = await setupService();
  t.after(() => audit.close());
  const saved = await service.save({ title: 'Valid', content: 'Visible.' });
  const id = saved.structuredContent?.id as string;
  await writeFile(path.join(memoryDirectory, 'mem_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.md'), 'invalid');
  const recoverableTombstone = path.join(
    memoryDirectory,
    '.loom-delete-mem_cccccccccccccccccccccccccccccccc-safe.tmp',
  );
  await writeFile(recoverableTombstone, 'committed delete residue', { mode: 0o600 });
  const unsafeTombstone = path.join(
    memoryDirectory,
    '.loom-delete-mem_dddddddddddddddddddddddddddddddd-unsafe.tmp',
  );
  await writeFile(unsafeTombstone, 'unsafe residue', { mode: 0o644 });
  await writeFile(path.join(memoryDirectory, 'notes.txt'), 'unknown');

  await service.rescan();
  const current = service.getSnapshot();
  assert.deepEqual(current.memories.map((memory) => memory.id), [id]);
  assert.equal((await readdir(memoryDirectory)).includes(path.basename(recoverableTombstone)), false);
  assert.equal((await readdir(memoryDirectory)).includes(path.basename(unsafeTombstone)), true);
  assert.deepEqual(
    current.diagnostics.map((item) => item.code).sort(),
    ['invalid_memory_skipped', 'unknown_entry_skipped', 'unsafe_tombstone_skipped'],
  );
});

test('memory dispatcher handles every memory action and delegates other Loom tools', async (t) => {
  const { audit, service } = await setupService();
  t.after(() => audit.close());
  const delegated: Array<[string, Record<string, unknown>]> = [];
  const dispatcher = createMemoryToolDispatcher(service, async (name, arguments_) => {
    delegated.push([name, arguments_]);
    return { content: [{ type: 'text', text: 'delegated' }] };
  });

  const saved = await dispatcher('loom_memory', {
    action: 'save',
    title: 'Dispatcher',
    content: 'Stored.',
  });
  const id = saved.structuredContent?.id as string;
  await dispatcher('loom_memory', { action: 'list' });
  await dispatcher('loom_memory', { action: 'search', query: 'Dispatcher' });
  await dispatcher('loom_memory', { action: 'read', id });
  await dispatcher('loom_memory', { action: 'rescan' });
  await dispatcher('loom_memory', { action: 'delete', id });
  await dispatcher('loom_browser', { action: 'status' });

  assert.deepEqual(delegated, [['loom_browser', { action: 'status' }]]);
});
