import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildAgentKit } from '../scripts/build-agent-kit.js';
import {
  parseMermaid,
  createFlowchartModel,
  layoutFlowchart,
  renderFlowchartSvg,
} from '../src/lib/flowchart/index.js';

let directory, kit, cli, built, source, raw;
const permissionFlag = process.allowedNodeEnvironmentFlags.has('--permission')
  ? '--permission'
  : '--experimental-permission';
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'flowchart-agent-kit 測試 '));
  kit = join(directory, 'kit');
  built = await buildAgentKit(kit);
  cli = join(kit, 'flowchart-convert.mjs');
  source = await readFile(new URL('../examples/flowchart/batch-update.mmd', import.meta.url), 'utf8');
  raw = parseMermaid(source);
  await writeFile(join(directory, 'source.mmd'), source);
  await writeFile(join(directory, 'source.json'), JSON.stringify(raw));
});
after(async () => {
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
  assert.ok(basename(directory).startsWith('flowchart-agent-kit '));
  await rm(directory, { recursive: true, force: true });
});
function run(args, input) {
  return spawnSync(
    process.execPath,
    [
      '--no-warnings',
      permissionFlag,
      `--allow-fs-read=${directory}`,
      `--allow-fs-write=${directory}`,
      cli,
      ...args,
    ],
    {
      cwd: directory,
      input,
      encoding: 'utf8',
      timeout: 30000,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, NODE_PATH: '' },
    },
  );
}

test('copied standalone Flowchart kit compiles Mermaid to portable JSON and exactly matching SVG', async () => {
  assert.deepEqual((await readdir(kit)).sort(), [
    'README.md',
    'blockchart-convert.mjs',
    'blockchart-edit.mjs',
    'blockchart.schema.json',
    'flowchart-convert.mjs',
    'flowchart.schema.json',
    'statechart-convert.mjs',
    'statechart.schema.json',
  ]);
  const json = run(['source.mmd', '--output', '-', '--format', 'json']);
  assert.equal(json.status, 0, json.stderr);
  assert.deepEqual(JSON.parse(json.stdout), raw);
  const svg = run(['source.mmd', '--output', '-', '--format', 'svg']);
  assert.equal(svg.status, 0, svg.stderr);
  assert.equal(svg.stderr, '');
  assert.equal(svg.stdout, renderFlowchartSvg(await layoutFlowchart(createFlowchartModel(raw))) + '\n');
  const fromJson = run(['source.json', '--output', '-', '--format', 'svg']);
  assert.equal(fromJson.status, 0, fromJson.stderr);
  assert.equal(fromJson.stdout, svg.stdout);
  assert.equal(run(['--version']).stdout.trim(), built.flowchartVersion);
  const schema = await readFile(join(kit, 'flowchart.schema.json'), 'utf8');
  assert.equal(
    schema.replace(/\r\n/g, '\n'),
    (await readFile(new URL('../schema/flowchart.schema.json', import.meta.url), 'utf8')).replace(
      /\r\n/g,
      '\n',
    ),
  );
});

test('standalone stdin, file output and authoring omissions remain independent of the checkout', async () => {
  const json = run(['-', '--input-format', 'json', '--output', '-', '--format', 'json'], JSON.stringify(raw));
  assert.equal(json.status, 0, json.stderr);
  assert.deepEqual(JSON.parse(json.stdout), raw);
  const result = run(['source.mmd', '--output', 'images/result.svg']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.match(await readFile(join(directory, 'images/result.svg'), 'utf8'), /^<svg /);
  const check = run(['source.mmd', '--check', '--diagnostics', 'json']);
  assert.equal(check.status, 0, check.stderr);
  assert.equal(check.stdout, '');
  assert.deepEqual(JSON.parse(check.stderr), {
    ok: true,
    stage: 'validation',
    kitVersion: built.flowchartVersion,
  });
});

test('standalone errors report source locations and stages while preserving existing files', async () => {
  const syntax = run(
    ['-', '--output', '-', '--format', 'svg', '--diagnostics', 'json'],
    'flowchart TD\nA@{shape:unknown}',
  );
  assert.equal(syntax.status, 1);
  const info = JSON.parse(syntax.stderr);
  assert.equal(info.stage, 'parse');
  assert.equal(info.line, 2);
  assert.ok(info.column > 0);
  const bad = {
    version: 1,
    diagram: { name: 'Bad' },
    nodes: [{ id: 'A' }],
    edges: [{ from: 'A', to: 'Missing' }],
  };
  await writeFile(join(directory, 'keep.svg'), 'keep');
  const invalid = run(
    ['-', '--input-format', 'json', '--output', 'keep.svg', '--diagnostics', 'json'],
    JSON.stringify(bad),
  );
  assert.equal(invalid.status, 1);
  assert.equal(JSON.parse(invalid.stderr).stage, 'validation');
  assert.equal(await readFile(join(directory, 'keep.svg'), 'utf8'), 'keep');
  for (const args of [
    ['source.mmd', '--output', 'x.png'],
    ['source.mmd', '--output', 'x.svg', '--format', 'json'],
    ['source.mmd', '--unknown'],
    ['source.json', '--output', 'source.json'],
  ]) {
    const result = run([...args, '--diagnostics', 'json']);
    assert.equal(result.status, 2, result.stderr);
    assert.equal(JSON.parse(result.stderr).stage, 'arguments');
  }
  assert.deepEqual(JSON.parse(await readFile(join(directory, 'source.json'), 'utf8')), raw);
});

test('importable standalone Flowchart API has no CLI side effects, no source dependency and no input mutation', () => {
  const script = `import fs from 'node:fs/promises';import assert from 'node:assert/strict';import {parseMermaid,validateFlowchart,convertFlowchart,KIT_VERSION} from ${JSON.stringify(pathToFileURL(cli).href)};const text=await fs.readFile('source.mmd','utf8'),raw=parseMermaid(text),before=structuredClone(raw);assert.deepEqual(validateFlowchart(raw),{ok:true});assert.deepEqual(validateFlowchart(JSON.stringify(raw),{inputFormat:'json'}),{ok:true});const json=await convertFlowchart(text,{format:'json'}),svg=await convertFlowchart(raw);assert.deepEqual(JSON.parse(json.text),raw);assert.ok(svg.text.startsWith('<svg'));assert.deepEqual(raw,before);await assert.rejects(convertFlowchart(raw,{format:'png'}));assert.equal(KIT_VERSION,${JSON.stringify(built.flowchartVersion)});`;
  const result = spawnSync(
    process.execPath,
    ['--no-warnings', permissionFlag, `--allow-fs-read=${directory}`, '--input-type=module', '-e', script],
    { cwd: directory, encoding: 'utf8', timeout: 30000, env: { ...process.env, NODE_PATH: '' } },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
});

test('shared README Mermaid and Flowchart JSON examples execute from the standalone module', async () => {
  const readme = await readFile(join(kit, 'README.md'), 'utf8'),
    guide = readme.split('## Flowchart Agent Kit')[1].split('## Bundled elkjs license')[0];
  assert.ok(!readme.includes('{{'));
  assert.ok(readme.includes(built.flowchartVersion) && readme.includes(built.version));
  const blocks = [...guide.matchAll(/```(mermaid|json)\r?\n([\s\S]*?)\r?\n```/g)];
  assert.equal(blocks.length, 2);
  for (const [, kind, input] of blocks) {
    const result = run(
      ['-', '--input-format', kind === 'json' ? 'json' : 'mermaid', '--output', '-', '--format', 'svg'],
      input,
    );
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^<svg /);
  }
});
