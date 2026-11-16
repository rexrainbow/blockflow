import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildAgentKit } from '../scripts/build-agent-kit.js';
import { convertStatechart } from '../src/agent-kit/statechart-converter.js';
const permissionFlag = process.allowedNodeEnvironmentFlags.has('--permission')
  ? '--permission'
  : '--experimental-permission';

test('standalone Statechart kit runs without checkout access, matches runtime and preserves files on errors', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'statechart-kit-'));
  t.after(async () => {
    assert.equal(dirname(directory), resolve(tmpdir()));
    await rm(directory, { recursive: true, force: true });
  });
  const kit = join(directory, 'kit');
  const built = await buildAgentKit(kit);
  const cli = join(kit, 'statechart-convert.mjs'),
    source = await readFile(new URL('../examples/statechart/task-controller.mmd', import.meta.url), 'utf8');
  await writeFile(join(directory, 'task-controller.mmd'), source);
  const run = (args, input) =>
    spawnSync(
      process.execPath,
      [permissionFlag, `--allow-fs-read=${directory}`, `--allow-fs-write=${directory}`, cli, ...args],
      { cwd: directory, encoding: 'utf8', input, timeout: 30000 },
    );
  const version = run(['--version']);
  assert.equal(version.status, 0, version.stderr);
  assert.match(version.stdout, new RegExp(built.statechartVersion));
  const json = run(['task-controller.mmd', '--output', '-', '--format', 'json']);
  assert.equal(json.status, 0, json.stderr);
  const raw = JSON.parse(json.stdout);
  assert.equal(raw.states.length, 7);
  assert.equal(raw.transitions.length, 16);
  const svg = run(['task-controller.mmd', '--output', '-', '--format', 'svg']);
  assert.equal(svg.status, 0, svg.stderr);
  assert.equal(svg.stdout, (await convertStatechart(raw)).text);
  const schema = await readFile(join(kit, 'statechart.schema.json'), 'utf8');
  assert.equal(
    schema,
    (await readFile(new URL('../schema/statechart.schema.json', import.meta.url), 'utf8')).replaceAll(
      '\r\n',
      '\n',
    ),
  );
  await writeFile(join(directory, 'existing.svg'), 'KEEP');
  const bad = run(['-', '--output', 'existing.svg', '--diagnostics', 'json'], 'stateDiagram-v2\nstate X {');
  assert.equal(bad.status, 1);
  assert.equal(JSON.parse(bad.stderr).line, 2);
  assert.equal(await readFile(join(directory, 'existing.svg'), 'utf8'), 'KEEP');
  const legacy = { ...raw, layout: { ...raw.layout, loopSide: 'left' } };
  const rejected = run(
    ['-', '--input-format', 'json', '--output', 'existing.svg', '--diagnostics', 'json'],
    JSON.stringify(legacy),
  );
  assert.equal(rejected.status, 1);
  assert.equal(JSON.parse(rejected.stderr).path, 'layout.loopSide');
  assert.equal(await readFile(join(directory, 'existing.svg'), 'utf8'), 'KEEP');
  const wrong = run(['task-controller.mmd', '--output', 'task-controller.mmd']);
  assert.notEqual(wrong.status, 0);
  assert.equal(await readFile(join(directory, 'task-controller.mmd'), 'utf8'), source);
  const committed = await readFile(new URL('../agent-kit/statechart-convert.mjs', import.meta.url), 'utf8');
  assert.equal(committed, await readFile(cli, 'utf8'));
});
