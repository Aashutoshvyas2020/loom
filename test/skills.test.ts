import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  SkillCatalogConfigError,
  SkillCatalogLimitError,
  SkillCatalogService,
  createSkillToolDispatcher,
} from '../src/tools/skills.js';

async function tempRoot(prefix = 'loom-skills-'): Promise<string> {
  return realpath(await mkdtemp(path.join(tmpdir(), prefix)));
}

async function writeSkill(
  root: string,
  relativeDirectory: string,
  options: { name: string; description: string; body?: string },
): Promise<string> {
  const directory = path.join(root, relativeDirectory);
  await mkdir(directory, { recursive: true });
  const skillPath = path.join(directory, 'SKILL.md');
  await writeFile(
    skillPath,
    `---\nname: ${options.name}\ndescription: ${options.description}\n---\n\n# ${options.name}\n\n${options.body ?? options.description}\n`,
  );
  return skillPath;
}

function snapshot(service: SkillCatalogService) {
  return service.getSnapshot();
}

test('skill discovery is deterministic, namespaced, duplicate-aware, and stable across rescans', async () => {
  const alpha = await tempRoot('loom-skills-alpha-');
  const beta = await tempRoot('loom-skills-beta-');
  await writeSkill(alpha, 'photo/shared', {
    name: 'Shared Skill',
    description: 'Alpha camera workflow',
  });
  const betaPath = await writeSkill(beta, 'other/shared', {
    name: 'Shared Skill',
    description: 'Beta editing workflow',
  });
  await writeSkill(alpha, 'unique', {
    name: 'Unique Skill',
    description: 'A unique planning method',
  });

  const service = new SkillCatalogService({
    roots: [
      { namespace: 'beta', path: beta },
      { namespace: 'alpha', path: alpha },
    ],
  });
  await service.rescan();

  const first = snapshot(service);
  assert.equal(first.generation, 1);
  assert.deepEqual(first.skills.map((skill) => skill.id), [
    'alpha:photo/shared',
    'alpha:unique',
    'beta:other/shared',
  ]);
  const shared = first.skills.filter((skill) => skill.name === 'Shared Skill');
  assert.equal(shared.length, 2);
  assert.equal(shared.every((skill) => skill.duplicateName), true);
  assert.equal(shared.every((skill) => skill.duplicateCount === 2), true);

  await writeFile(betaPath, `${await readFile(betaPath, 'utf8')}\nUpdated body.\n`);
  await service.rescan();
  const second = snapshot(service);
  assert.equal(second.generation, 2);
  assert.deepEqual(second.skills.map((skill) => skill.id), first.skills.map((skill) => skill.id));
});

test('list, search, and read use stable IDs with deterministic ranking', async () => {
  const root = await tempRoot();
  await writeSkill(root, 'camera', {
    name: 'Camera Planner',
    description: 'Plan a camera shoot and lens selection',
    body: 'Use this when choosing a camera and composing photographs.',
  });
  await writeSkill(root, 'generic', {
    name: 'General Planner',
    description: 'Plan ordinary project work',
    body: 'A camera may be mentioned once in a supporting example.',
  });
  await writeSkill(root, 'unrelated', {
    name: 'Code Reviewer',
    description: 'Review TypeScript changes',
  });

  const service = new SkillCatalogService({ roots: [{ namespace: 'local', path: root }] });
  await service.rescan();

  const listed = await service.list();
  const listedSkills = listed.structuredContent?.skills as Array<{ id: string }>;
  assert.deepEqual(listedSkills.map((skill) => skill.id), [
    'local:camera',
    'local:generic',
    'local:unrelated',
  ]);

  const searched = await service.search({ query: 'camera', limit: 2 });
  const results = searched.structuredContent?.skills as Array<{ id: string; score: number }>;
  assert.deepEqual(results.map((result) => result.id), ['local:camera', 'local:generic']);
  assert.equal(results[0]!.score > results[1]!.score, true);

  const read = await service.read({ id: 'local:camera' });
  const item = read.content[0];
  assert.ok(item && item.type === 'text');
  assert.match(item.text, /choosing a camera/);
  assert.equal(read.structuredContent?.id, 'local:camera');
  await assert.rejects(service.read({ id: 'local:missing' }), SkillCatalogConfigError);
});

test('nested symlinks are never followed and are reported without discarding safe skills', async () => {
  const root = await tempRoot();
  const external = await tempRoot('loom-skills-external-');
  await writeSkill(root, 'safe', {
    name: 'Safe Skill',
    description: 'Stored directly under the configured root',
  });
  await writeSkill(external, 'hidden', {
    name: 'Hidden Skill',
    description: 'Must not be reached through a symlink',
  });
  await symlink(path.join(external, 'hidden'), path.join(root, 'linked'));

  const service = new SkillCatalogService({ roots: [{ namespace: 'local', path: root }] });
  await service.rescan();
  const current = snapshot(service);

  assert.deepEqual(current.skills.map((skill) => skill.id), ['local:safe']);
  assert.equal(current.diagnostics.some((item) => item.code === 'symlink_skipped'), true);
});

test('a symbolic-link root aborts rescan and preserves the prior catalog generation', async () => {
  const safeRoot = await tempRoot();
  await writeSkill(safeRoot, 'safe', {
    name: 'Safe Skill',
    description: 'Initial safe snapshot',
  });
  const parent = await tempRoot('loom-skills-link-parent-');
  const linkedRoot = path.join(parent, 'linked-root');
  await symlink(safeRoot, linkedRoot);

  const service = new SkillCatalogService({ roots: [{ namespace: 'local', path: safeRoot }] });
  await service.rescan();
  const before = snapshot(service);
  service.replaceRoots([{ namespace: 'local', path: linkedRoot }]);

  await assert.rejects(service.rescan(), SkillCatalogConfigError);
  assert.deepEqual(snapshot(service), before);
});

test('unterminated frontmatter is skipped with a deterministic malformed diagnostic', async () => {
  const root = await tempRoot();
  const malformedDirectory = path.join(root, 'malformed');
  await mkdir(malformedDirectory);
  await writeFile(
    path.join(malformedDirectory, 'SKILL.md'),
    '---\nname: Poisoned\ndescription: Must not be partially indexed\n# Body heading\nBody text\n',
  );
  await writeSkill(root, 'valid', {
    name: 'Valid Skill',
    description: 'Remains visible beside malformed input',
  });

  const service = new SkillCatalogService({ roots: [{ namespace: 'local', path: root }] });
  await service.rescan();
  const current = snapshot(service);

  assert.deepEqual(current.skills.map((skill) => skill.id), ['local:valid']);
  assert.deepEqual(current.diagnostics.map((item) => item.code), [
    'malformed_frontmatter_skipped',
  ]);
  assert.equal(current.totalBytes, current.skills[0]?.bytes);
});

test('oversized and over-depth SKILL.md files are skipped with deterministic diagnostics', async () => {
  const root = await tempRoot();
  await writeSkill(root, 'good', {
    name: 'Good Skill',
    description: 'Within every configured bound',
  });
  await writeSkill(root, 'too/deep', {
    name: 'Deep Skill',
    description: 'Beyond the configured depth',
  });
  const oversizedDirectory = path.join(root, 'oversized');
  await mkdir(oversizedDirectory);
  await writeFile(path.join(oversizedDirectory, 'SKILL.md'), 'x'.repeat(129));

  const service = new SkillCatalogService({
    roots: [{ namespace: 'local', path: root }],
    limits: {
      maxDepth: 1,
      maxFileBytes: 128,
    },
  });
  await service.rescan();
  const current = snapshot(service);

  assert.deepEqual(current.skills.map((skill) => skill.id), ['local:good']);
  assert.deepEqual(
    current.diagnostics.map((item) => item.code).sort(),
    ['depth_skipped', 'oversized_skill_skipped'],
  );
});

test('entry-limit failure aborts the scan and keeps the prior immutable snapshot', async () => {
  const root = await tempRoot();
  await writeSkill(root, 'safe', {
    name: 'Safe Skill',
    description: 'Initial indexed skill',
  });
  const service = new SkillCatalogService({
    roots: [{ namespace: 'local', path: root }],
    limits: { maxEntriesPerRoot: 5 },
  });
  await service.rescan();
  const before = snapshot(service);

  for (let index = 0; index < 6; index += 1) {
    await writeFile(path.join(root, `junk-${index}.txt`), 'junk');
  }
  await assert.rejects(service.rescan(), SkillCatalogLimitError);
  assert.deepEqual(snapshot(service), before);
});

test('total indexed-byte failure and scan timeout abort without publishing partial results', async () => {
  const byteRoot = await tempRoot();
  await writeSkill(byteRoot, 'one', {
    name: 'One',
    description: 'Small first skill',
    body: 'a'.repeat(40),
  });
  const byteService = new SkillCatalogService({
    roots: [{ namespace: 'local', path: byteRoot }],
    limits: { maxTotalBytes: 512 },
  });
  await byteService.rescan();
  const before = snapshot(byteService);
  await writeSkill(byteRoot, 'two', {
    name: 'Two',
    description: 'Second skill pushes total over the test cap',
    body: 'b'.repeat(400),
  });
  await assert.rejects(byteService.rescan(), SkillCatalogLimitError);
  assert.deepEqual(snapshot(byteService), before);

  const timeoutRoot = await tempRoot();
  await writeSkill(timeoutRoot, 'slow', {
    name: 'Slow Skill',
    description: 'The fake clock expires during traversal',
  });
  let time = 0;
  const timeoutService = new SkillCatalogService({
    roots: [{ namespace: 'local', path: timeoutRoot }],
    limits: { scanDeadlineMs: 10 },
    now: () => {
      time += 6;
      return time;
    },
  });
  await assert.rejects(timeoutService.rescan(), SkillCatalogLimitError);
  assert.equal(snapshot(timeoutService).generation, 0);
  assert.deepEqual(snapshot(timeoutService).skills, []);
});

test('missing roots are diagnosed, while duplicate namespaces and paths are rejected explicitly', async () => {
  const root = await tempRoot();
  const missing = path.join(root, 'missing');
  const service = new SkillCatalogService({
    roots: [{ namespace: 'missing', path: missing }],
  });
  await service.rescan();
  assert.deepEqual(snapshot(service).skills, []);
  assert.equal(snapshot(service).diagnostics[0]?.code, 'root_missing');

  assert.throws(() => new SkillCatalogService({
    roots: [
      { namespace: 'duplicate', path: root },
      { namespace: 'duplicate', path: path.join(root, 'other') },
    ],
  }), SkillCatalogConfigError);
  assert.throws(() => new SkillCatalogService({
    roots: [
      { namespace: 'one', path: root },
      { namespace: 'two', path: root },
    ],
  }), SkillCatalogConfigError);
});

test('skill dispatcher handles loom_skills and delegates the other six public tools', async () => {
  const root = await tempRoot();
  await writeSkill(root, 'safe', {
    name: 'Safe Skill',
    description: 'Dispatcher fixture',
  });
  const service = new SkillCatalogService({ roots: [{ namespace: 'local', path: root }] });
  const delegated: Array<[string, Record<string, unknown>]> = [];
  const dispatcher = createSkillToolDispatcher(service, async (name, arguments_) => {
    delegated.push([name, arguments_]);
    return { content: [{ type: 'text', text: 'delegated' }] };
  });

  await dispatcher('loom_skills', { action: 'rescan' });
  const listed = await dispatcher('loom_skills', { action: 'list' });
  const skills = listed.structuredContent?.skills as Array<{ id: string }>;
  assert.deepEqual(skills.map((skill) => skill.id), ['local:safe']);

  await dispatcher('loom_read', { path: '/tmp/example.txt' });
  assert.deepEqual(delegated, [['loom_read', { path: '/tmp/example.txt' }]]);
});
