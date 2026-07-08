import assert from 'node:assert/strict';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { AuditLogger, AuditUnavailableError } from '../src/audit.js';

async function tempAuditDirectory(): Promise<string> {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'loom-audit-')));
  const auditDirectory = path.join(root, 'audit');
  await mkdir(auditDirectory, { mode: 0o700 });
  return auditDirectory;
}

async function readAllRecords(auditDirectory: string): Promise<Record<string, unknown>[]> {
  const records: Record<string, unknown>[] = [];
  for (const name of (await readdir(auditDirectory)).sort()) {
    if (!name.endsWith('.jsonl')) {
      continue;
    }
    const text = await readFile(path.join(auditDirectory, name), 'utf8');
    for (const line of text.split('\n').filter(Boolean)) {
      records.push(JSON.parse(line) as Record<string, unknown>);
    }
  }
  return records;
}

test('audit startup repairs the current owner directory to mode 0700', async () => {
  const auditDirectory = await tempAuditDirectory();
  await chmod(auditDirectory, 0o755);

  const logger = await AuditLogger.create({ auditDirectory });

  assert.equal((await stat(auditDirectory)).mode & 0o777, 0o700);
  await logger.close();
});

test('mutation start is durable before resolving and finish records status/duration', async () => {
  const auditDirectory = await tempAuditDirectory();
  const now = new Date('2026-07-08T07:00:00.000Z');
  const logger = await AuditLogger.create({ auditDirectory, now: () => now });

  const receipt = await logger.recordMutationStart('file.write', { path: '/tmp/example.txt' });
  const logPath = path.join(auditDirectory, '2026-07-08.jsonl');
  const afterStart = await readFile(logPath, 'utf8');
  assert.match(afterStart, /"phase":"start"/);
  assert.match(afterStart, /"operation":"file.write"/);
  assert.equal((await stat(logPath)).mode & 0o777, 0o600);

  now.setTime(now.getTime() + 25);
  assert.equal(await logger.recordFinish(receipt, 'ok'), true);
  await logger.close();

  const records = await readAllRecords(auditDirectory);
  assert.equal(records.length, 2);
  assert.equal(records[1]!.phase, 'finish');
  assert.equal(records[1]!.status, 'ok');
  assert.equal(records[1]!.durationMs, 25);
});

test('saturated mutation-start queue fails closed and marks audit degraded', async () => {
  const auditDirectory = await tempAuditDirectory();
  const logger = await AuditLogger.create({
    auditDirectory,
    queueCapacity: 1,
    now: () => new Date('2026-07-08T07:00:00.000Z'),
  });

  const first = logger.recordMutationStart('terminal.start', { jobId: 'one' });
  await assert.rejects(
    logger.recordMutationStart('terminal.start', { jobId: 'two' }),
    AuditUnavailableError,
  );
  await first.catch(() => undefined);

  assert.equal(logger.degraded, true);
  await assert.rejects(
    logger.recordMutationStart('terminal.start', { jobId: 'three' }),
    AuditUnavailableError,
  );
  await logger.close();
});

test('mutation start fails closed when durable acceptance exceeds its deadline', async () => {
  const auditDirectory = await tempAuditDirectory();
  const logger = await AuditLogger.create({
    auditDirectory,
    startDeadlineMs: 1,
    now: () => new Date('2026-07-08T07:00:00.000Z'),
  });

  await assert.rejects(
    logger.recordMutationStart('terminal.start', { jobId: 'deadline' }),
    AuditUnavailableError,
  );
  assert.equal(logger.degraded, true);
  await logger.close();
});

test('write failure rejects mutations while read audit remains non-throwing', async () => {
  const auditDirectory = await tempAuditDirectory();
  const logger = await AuditLogger.create({
    auditDirectory,
    now: () => new Date('2026-07-08T07:00:00.000Z'),
  });
  await rm(auditDirectory, { recursive: true });

  await assert.rejects(
    logger.recordMutationStart('memory.save', { memoryId: 'm1' }),
    AuditUnavailableError,
  );
  assert.equal(logger.degraded, true);
  assert.equal(await logger.recordRead('file.read', { path: '/tmp/readable.txt' }), false);
  await logger.close();
});

test('serialized rotation produces complete parseable JSONL records', async () => {
  const auditDirectory = await tempAuditDirectory();
  const logger = await AuditLogger.create({
    auditDirectory,
    maxFileBytes: 320,
    queueCapacity: 20,
    now: () => new Date('2026-07-08T07:00:00.000Z'),
  });

  const results = await Promise.all(
    Array.from({ length: 10 }, (_, index) => logger.recordRead('skills.search', {
      queryId: index,
      safe: 'x'.repeat(40),
    })),
  );
  assert.equal(results.every(Boolean), true);
  await logger.close();

  const files = (await readdir(auditDirectory)).filter((name) => name.endsWith('.jsonl'));
  assert.equal(files.length > 1, true);
  const records = await readAllRecords(auditDirectory);
  assert.equal(records.length, 10);
  assert.deepEqual(
    records.map((record) => (record.metadata as { queryId: number }).queryId).sort((a, b) => a - b),
    Array.from({ length: 10 }, (_, index) => index),
  );
});

test('startup retention removes only audit files older than the fixed window', async () => {
  const auditDirectory = await tempAuditDirectory();
  await writeFile(path.join(auditDirectory, '2026-05-01.jsonl'), '{}\n');
  await writeFile(path.join(auditDirectory, '2026-06-20.1.jsonl'), '{}\n');
  await writeFile(path.join(auditDirectory, 'notes.txt'), 'keep');

  const logger = await AuditLogger.create({
    auditDirectory,
    retentionDays: 30,
    now: () => new Date('2026-07-08T07:00:00.000Z'),
  });
  await logger.close();

  const names = await readdir(auditDirectory);
  assert.equal(names.includes('2026-05-01.jsonl'), false);
  assert.equal(names.includes('2026-06-20.1.jsonl'), true);
  assert.equal(names.includes('notes.txt'), true);
});

test('audit metadata redacts commands, secrets, content, environment, and token-like values', async () => {
  const auditDirectory = await tempAuditDirectory();
  const logger = await AuditLogger.create({
    auditDirectory,
    now: () => new Date('2026-07-08T07:00:00.000Z'),
  });

  await logger.recordRead('safe.operation', {
    path: '/Users/example/file.txt',
    command: 'echo super-secret-command',
    content: 'private file body',
    environment: { API_KEY: 'secret-env-value' },
    authorization: 'Bearer abc123',
    nested: {
      refreshToken: 'refresh-secret',
      harmlessButTokenLike: 'Bearer leaked-value',
    },
  });
  await logger.close();

  const raw = (await readFile(path.join(auditDirectory, '2026-07-08.jsonl'), 'utf8'));
  assert.match(raw, /\/Users\/example\/file\.txt/);
  for (const forbidden of [
    'super-secret-command',
    'private file body',
    'secret-env-value',
    'abc123',
    'refresh-secret',
    'leaked-value',
  ]) {
    assert.equal(raw.includes(forbidden), false);
  }
  assert.match(raw, /\[REDACTED\]/);
});
