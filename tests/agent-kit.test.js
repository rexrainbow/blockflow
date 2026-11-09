import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { join, dirname, basename, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildAgentKit } from '../scripts/build-agent-kit.js';
import { createDiagramModel, layoutDiagram, renderSvg } from '../src/lib/index.js';

let directory, kit, cli, raw, built;
const names = ['README.md', 'blockflow-convert.mjs', 'blockflow.schema.json'];
const permissionFlag = process.allowedNodeEnvironmentFlags.has('--permission')
  ? '--permission'
  : '--experimental-permission';
const lf = (text) => text.replace(/\r\n/g, '\n');
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'blockflow-agent-kit 空間 '));
  kit = join(directory, 'kit');
  built = await buildAgentKit(kit);
  cli = join(kit, 'blockflow-convert.mjs');
  raw = JSON.parse(await readFile(new URL('../examples/vertical-flow.json', import.meta.url), 'utf8'));
  await writeFile(join(directory, 'diagram.json'), JSON.stringify(raw), 'utf8');
});
after(async () => {
  // Delete only the absolute directory returned by this test's mkdtemp call.
  if (
    directory &&
    dirname(resolve(directory)) === resolve(tmpdir()) &&
    basename(directory).startsWith('blockflow-agent-kit ')
  )
    await rm(directory, { recursive: true, force: true });
});

function run(args, input) {
  // Restrict reads/writes to a temporary folder outside the checkout. A runtime
  // dependency on project files or node_modules must fail, rather than pass by accident.
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
      encoding: 'utf8',
      input,
      timeout: 30000,
      maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, NODE_PATH: '' },
    },
  );
}

test('three matched artifacts are reproducible, current and contain no extra runtime files', async () => {
  assert.deepEqual((await readdir(kit)).sort(), names);
  for (const name of names)
    assert.equal(
      lf(await readFile(join(kit, name), 'utf8')),
      lf(await readFile(new URL('../agent-kit/' + name, import.meta.url), 'utf8')),
      name + ' is stale; run npm run build:agent-kit',
    );
  assert.equal(
    lf(await readFile(join(kit, 'blockflow.schema.json'), 'utf8')),
    lf(await readFile(new URL('../schema/blockflow.schema.json', import.meta.url), 'utf8')),
  );
  const result = run(['--version']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), built.version);
  assert.equal(result.stderr, '');
});

test('isolated no-install CLI exports the same vertical SVG as the shared renderer', async () => {
  const result = run(['diagram.json', '--output', 'images/vertical.svg', '--diagnostics', 'json']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  const diagnostics = JSON.parse(result.stderr);
  assert.equal(diagnostics.ok, true);
  assert.equal(diagnostics.format, 'svg');
  assert.equal(diagnostics.kitVersion, built.version);
  assert.equal(
    await readFile(join(directory, 'images/vertical.svg'), 'utf8'),
    renderSvg(await layoutDiagram(createDiagramModel(raw))) + '\n',
  );
});

test('JSON export preserves the full raw authoring graph and omissions without normalization', async () => {
  const result = run(['diagram.json', '--output', 'saved.json', '--diagnostics', 'json']);
  assert.equal(result.status, 0, result.stderr);
  const saved = JSON.parse(await readFile(join(directory, 'saved.json'), 'utf8'));
  assert.deepEqual(saved, raw);
  assert.equal(saved.modules.find((m) => m.type === 'concat').appearance, undefined);
  const check = run(['saved.json', '--check', '--diagnostics', 'json']);
  assert.equal(check.status, 0, check.stderr);
  assert.equal(JSON.parse(check.stderr).stage, 'validation');
  assert.equal(check.stdout, '');
});

test('stdin/stdout are clean for both formats and UTF-8 BOM input is accepted', () => {
  for (const format of ['json', 'svg']) {
    const result = run(
      ['-', '--output', '-', '--format', format, '--diagnostics', 'json'],
      '\uFEFF' + JSON.stringify(raw),
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stderr).ok, true);
    if (format === 'json') assert.deepEqual(JSON.parse(result.stdout), raw);
    else assert.ok(result.stdout.startsWith('<svg'));
  }
});

test('scoped SVG validates the full graph and exports only the selected group', async () => {
  const result = run(['diagram.json', '--output', 'scope.svg', '--view', 'Stage', '--diagnostics', 'json']);
  assert.equal(result.status, 0, result.stderr);
  const svg = await readFile(join(directory, 'scope.svg'), 'utf8');
  assert.ok(svg.includes('Selection stage'));
  assert.ok(svg.includes('Mux'));
  assert.ok(!svg.includes('Input processing'));
  assert.equal(svg, renderSvg(await layoutDiagram(createDiagramModel(raw), { rootGroupId: 'Stage' })) + '\n');
});

test('semantic and syntax errors have actionable stages/paths and preserve existing output', async () => {
  await writeFile(join(directory, 'existing.svg'), 'keep');
  const invalid = structuredClone(raw);
  invalid.modules.find((m) => m.id === 'Combine').ports.at(-1).width = 31;
  let result = run(['-', '--output', 'existing.svg', '--diagnostics', 'json'], JSON.stringify(invalid));
  assert.equal(result.status, 1);
  let error = JSON.parse(result.stderr);
  assert.equal(error.stage, 'validation');
  assert.match(error.path, /modules\[\d+\]\.ports/);
  assert.match(error.message, /sum/);
  assert.equal(await readFile(join(directory, 'existing.svg'), 'utf8'), 'keep');
  result = run(['-', '--check', '--diagnostics', 'json'], '{');
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stderr).stage, 'JSON');
  result = run(['missing.json', '--check', '--diagnostics', 'json']);
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stderr).stage, 'read');
  result = run(['diagram.json', '--output', 'existing.svg', '--view', 'Missing', '--diagnostics', 'json']);
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stderr).stage, 'layout');
  assert.equal(await readFile(join(directory, 'existing.svg'), 'utf8'), 'keep');
});

test('argument failures reject PNG, format mismatches and ambiguous commands; input is protected', async () => {
  for (const args of [
    [],
    ['diagram.json'],
    ['diagram.json', '--output', 'x.png'],
    ['diagram.json', '--output', 'x.svg', '--format', 'json'],
    ['diagram.json', '--check', '--view', 'Stage'],
    ['diagram.json', '--output', '-'],
    ['diagram.json', '--check', '--unknown'],
  ]) {
    const result = run([...args, '--diagnostics', 'json']);
    assert.equal(result.status, 2, JSON.stringify(args) + result.stderr);
    assert.equal(JSON.parse(result.stderr).stage, 'arguments');
  }
  const original = await readFile(join(directory, 'diagram.json'), 'utf8');
  const result = run(['diagram.json', '--output', 'diagram.json', '--diagnostics', 'json']);
  assert.equal(result.status, 1);
  assert.match(JSON.parse(result.stderr).message, /overwrite/);
  assert.equal(await readFile(join(directory, 'diagram.json'), 'utf8'), original);
});

test('importable API has no CLI side effects and preserves the supplied object', () => {
  const source = `import fs from 'node:fs/promises';import assert from 'node:assert/strict';import {convertDiagram,validateDiagram,KIT_VERSION} from ${JSON.stringify(pathToFileURL(cli).href)};const raw=JSON.parse(await fs.readFile('diagram.json','utf8')),before=structuredClone(raw);assert.deepEqual(validateDiagram(raw),{ok:true});const a=await convertDiagram(raw,{format:'json'}),b=await convertDiagram(raw,{format:'svg'});assert.deepEqual(JSON.parse(a.text),raw);assert.ok(b.text.startsWith('<svg'));assert.deepEqual(raw,before);await assert.rejects(convertDiagram(raw,{format:'png'}));assert.equal(KIT_VERSION,${JSON.stringify(built.version)});`;
  const result = spawnSync(
    process.execPath,
    ['--no-warnings', permissionFlag, `--allow-fs-read=${directory}`, '--input-type=module', '-e', source],
    { cwd: directory, encoding: 'utf8', timeout: 30000, env: { ...process.env, NODE_PATH: '' } },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
});

test('all standalone README JSON examples validate and render without upstream examples', async () => {
  const readme = await readFile(join(kit, 'README.md'), 'utf8'),
    examples = [...readme.matchAll(/```json\r?\n([\s\S]*?)\r?\n```/g)];
  assert.equal(examples.length, 3);
  for (const match of examples) {
    const model = createDiagramModel(JSON.parse(match[1]));
    assert.ok(renderSvg(await layoutDiagram(model)).startsWith('<svg'));
  }
  assert.ok(!/\]\((?:\.\.\/|examples\/)/.test(readme));
  assert.ok(!readme.includes('{{KIT_VERSION}}'));
});
