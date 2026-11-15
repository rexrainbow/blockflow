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
const names = [
  'README.md',
  'blockchart-convert.mjs',
  'blockchart.schema.json',
  'flowchart-convert.mjs',
  'flowchart.schema.json',
];
const permissionFlag = process.allowedNodeEnvironmentFlags.has('--permission')
  ? '--permission'
  : '--experimental-permission';
const lf = (text) => text.replace(/\r\n/g, '\n');
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'blockchart-agent-kit 空間 '));
  kit = join(directory, 'kit');
  built = await buildAgentKit(kit);
  cli = join(kit, 'blockchart-convert.mjs');
  raw = JSON.parse(await readFile(new URL('../examples/vertical-flow.json', import.meta.url), 'utf8'));
  await writeFile(join(directory, 'diagram.json'), JSON.stringify(raw), 'utf8');
});
after(async () => {
  // Delete only the absolute directory returned by this test's mkdtemp call.
  if (
    directory &&
    dirname(resolve(directory)) === resolve(tmpdir()) &&
    basename(directory).startsWith('blockchart-agent-kit ')
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

test('isolated kit renders Net label frames with the shared SVG renderer', async () => {
  const input = JSON.parse(
    await readFile(new URL('../examples/connection-labels.json', import.meta.url), 'utf8'),
  );
  const result = run(['-', '--output', '-', '--format', 'svg'], JSON.stringify(input));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, renderSvg(await layoutDiagram(createDiagramModel(input))) + '\n');
  assert.match(result.stdout, /stroke="#b38900"/);
  assert.match(result.stdout, /rx="4" ry="4"/);
  const json = run(['-', '--output', '-', '--format', 'json'], JSON.stringify(input));
  assert.equal(json.status, 0, json.stderr);
  assert.deepEqual(JSON.parse(json.stdout), input);
});

test('isolated kit renders default layout and preserves authored settings without runtime slots', async () => {
  const input = JSON.parse(
    await readFile(new URL('../examples/compact-layout.json', import.meta.url), 'utf8'),
  );
  const result = run(['-', '--output', '-', '--format', 'svg'], JSON.stringify(input));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, renderSvg(await layoutDiagram(createDiagramModel(input))) + '\n');
  const json = run(['-', '--output', '-', '--format', 'json'], JSON.stringify(input));
  assert.equal(json.status, 0, json.stderr);
  assert.deepEqual(JSON.parse(json.stdout), input);
  assert.ok(!result.stdout.includes('_receiverSlots'));
  input.layout.density = 'compact';
  const invalid = run(['-', '--output', '-', '--format', 'svg'], JSON.stringify(input));
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /density/);
});

test('isolated kit renders compact title-sized Blocks without changing relative size units or authoring JSON', async () => {
  const input = JSON.parse(
    await readFile(new URL('../examples/compact-labels.json', import.meta.url), 'utf8'),
  );
  const layout = await layoutDiagram(createDiagramModel(input));
  assert.equal(layout.modules.find((n) => n.id === 'ALU').width, 64);
  assert.equal(layout.modules.find((n) => n.id === 'ALU').height, 36);
  const svg = run(['-', '--output', '-', '--format', 'svg'], JSON.stringify(input));
  assert.equal(svg.status, 0, svg.stderr);
  assert.equal(svg.stdout, renderSvg(layout) + '\n');
  const json = run(['-', '--output', '-', '--format', 'json'], JSON.stringify(input));
  assert.equal(json.status, 0, json.stderr);
  assert.deepEqual(JSON.parse(json.stdout), input);
});

test('isolated kit infers cross-Container Grids without persisting runtime plans or accepting old fields', async () => {
  const input = JSON.parse(
    await readFile(new URL('../examples/processor-cross-group-grid.json', import.meta.url), 'utf8'),
  );
  const svg = run(['-', '--output', '-', '--format', 'svg'], JSON.stringify(input));
  assert.equal(svg.status, 0, svg.stderr);
  assert.equal(svg.stdout, renderSvg(await layoutDiagram(createDiagramModel(input))) + '\n');
  const json = run(['-', '--output', '-', '--format', 'json'], JSON.stringify(input));
  assert.equal(json.status, 0, json.stderr);
  assert.deepEqual(JSON.parse(json.stdout), input);
  input.layout.expandGroups = ['ComputeCluster'];
  const invalid = run(['-', '--output', '-', '--format', 'svg'], JSON.stringify(input));
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /expandGroups/);
});

test('isolated kit resolves shared Text, Group and Terminal defaults without authoring normalized values', async () => {
  const input = JSON.parse(
    await readFile(new URL('../examples/default-styles.json', import.meta.url), 'utf8'),
  );
  const svg = run(['-', '--output', '-', '--format', 'svg'], JSON.stringify(input));
  assert.equal(svg.status, 0, svg.stderr);
  assert.equal(svg.stdout, renderSvg(await layoutDiagram(createDiagramModel(input))) + '\n');
  for (const size of [12, 13, 14, 15, 16, 18]) assert.ok(svg.stdout.includes(`font-size="${size}"`));
  const json = run(['-', '--output', '-', '--format', 'json'], JSON.stringify(input));
  assert.equal(json.status, 0, json.stderr);
  assert.deepEqual(JSON.parse(json.stdout), input);
});

test('isolated kit exports adjusted Terminal names and matching endpoints', async () => {
  const input = JSON.parse(await readFile(new URL('../examples/terminals.json', import.meta.url), 'utf8'));
  input.layout = { ...input.layout, maxPortShift: 120 };
  const layout = await layoutDiagram(createDiagramModel(input));
  const result = run(['-', '--output', '-', '--format', 'svg'], JSON.stringify(input));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, renderSvg(layout) + '\n');
  assert.ok(layout.connections.every((e) => e.sections.length === 1 && e.sections[0].points.length === 2));
  const json = run(['-', '--output', '-', '--format', 'json'], JSON.stringify(input));
  assert.equal(json.status, 0, json.stderr);
  assert.deepEqual(JSON.parse(json.stdout), input);
});

test('isolated kit uses the same Port adjustment and preserves authoring JSON without coordinates', async () => {
  const document = JSON.parse(
    await readFile(new URL('../examples/port-adjustment.json', import.meta.url), 'utf8'),
  );
  await writeFile(join(directory, 'ports.json'), JSON.stringify(document));
  const svg = run(['ports.json', '--output', '-', '--format', 'svg']);
  assert.equal(svg.status, 0, svg.stderr);
  assert.equal(svg.stdout.trimEnd(), renderSvg(await layoutDiagram(createDiagramModel(document))));
  const json = run(['ports.json', '--output', '-', '--format', 'json']);
  assert.equal(json.status, 0, json.stderr);
  assert.deepEqual(JSON.parse(json.stdout), document);
});

test('five matched artifacts are reproducible, current and contain no extra runtime files', async () => {
  assert.deepEqual((await readdir(kit)).sort(), names);
  assert.match(built.version, /^blockchart-agent-kit-/);
  assert.match(built.flowchartVersion, /^flowchart-agent-kit-/);
  const help = run(['--help']);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /node blockchart-convert\.mjs/);
  for (const name of names)
    assert.equal(
      lf(await readFile(join(kit, name), 'utf8')),
      lf(await readFile(new URL('../agent-kit/' + name, import.meta.url), 'utf8')),
      name + ' is stale; run npm run build:agent-kit',
    );
  assert.equal(
    lf(await readFile(join(kit, 'blockchart.schema.json'), 'utf8')),
    lf(await readFile(new URL('../schema/blockchart.schema.json', import.meta.url), 'utf8')),
  );
  assert.equal(
    JSON.parse(await readFile(join(kit, 'blockchart.schema.json'), 'utf8')).$id,
    'urn:blockchart:diagram:1',
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

test('isolated CLI preserves and renders ComputeCluster Grid, sides, double arrows and caption', async () => {
  const input = JSON.parse(
    await readFile(new URL('../examples/processor-overview.json', import.meta.url), 'utf8'),
  );
  const saved = run(['-', '--output', '-', '--format', 'json'], JSON.stringify(input));
  assert.equal(saved.status, 0, saved.stderr);
  assert.deepEqual(JSON.parse(saved.stdout), input);
  const result = run(['-', '--output', '-', '--format', 'svg'], JSON.stringify(input));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, renderSvg(await layoutDiagram(createDiagramModel(input))) + '\n');
  assert.equal((result.stdout.match(/data-role="connection-start-arrow"/g) ?? []).length, 3);
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

test('isolated CLI renders partial Grids with automatic neighbors without rewriting the graph', async () => {
  const input = JSON.parse(await readFile(new URL('../examples/partial-grid.json', import.meta.url), 'utf8'));
  for (const format of ['json', 'svg']) {
    const result = run(['-', '--output', '-', '--format', format], JSON.stringify(input));
    assert.equal(result.status, 0, result.stderr);
    if (format === 'json') assert.deepEqual(JSON.parse(result.stdout), input);
    else assert.equal(result.stdout, renderSvg(await layoutDiagram(createDiagramModel(input))) + '\n');
  }
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

test('isolated kit preserves Container-local overrides, inherited omissions and scoped SVG', async () => {
  const input = JSON.parse(
    await readFile(new URL('../examples/local-layout-spacing.json', import.meta.url), 'utf8'),
  );
  const svg = run(['-', '--output', '-', '--format', 'svg'], JSON.stringify(input));
  assert.equal(svg.status, 0, svg.stderr);
  assert.equal(svg.stdout, renderSvg(await layoutDiagram(createDiagramModel(input))) + '\n');
  const json = run(['-', '--output', '-', '--format', 'json'], JSON.stringify(input));
  assert.equal(json.status, 0, json.stderr);
  const saved = JSON.parse(json.stdout);
  assert.deepEqual(saved, input);
  assert.equal(Object.hasOwn(saved.groups.find((g) => g.id === 'Inner').layout, 'layerSpacing'), false);
  const scoped = run(['-', '--output', '-', '--format', 'svg', '--view', 'Inner'], JSON.stringify(input));
  assert.equal(scoped.status, 0, scoped.stderr);
  assert.equal(
    scoped.stdout,
    renderSvg(await layoutDiagram(createDiagramModel(input), { rootGroupId: 'Inner' })) + '\n',
  );
});

test('isolated kit renders adjacent Auto Container channels with local spacing and scoped names', async () => {
  const input = JSON.parse(
    await readFile(new URL('../examples/auto-routing-channels.json', import.meta.url), 'utf8'),
  );
  for (const direction of ['down', 'right']) {
    input.layout.direction = direction;
    const actual = run(['-', '--output', '-', '--format', 'svg'], JSON.stringify(input));
    assert.equal(actual.status, 0, actual.stderr);
    assert.equal(actual.stdout, renderSvg(await layoutDiagram(createDiagramModel(input))) + '\n');
  }
  const scoped = run(['-', '--output', '-', '--format', 'svg', '--view', 'Fabric'], JSON.stringify(input));
  assert.equal(scoped.status, 0, scoped.stderr);
  assert.equal(
    scoped.stdout,
    renderSvg(await layoutDiagram(createDiagramModel(input), { rootGroupId: 'Fabric' })) + '\n',
  );
  const json = run(['-', '--output', '-', '--format', 'json'], JSON.stringify(input));
  assert.equal(json.status, 0, json.stderr);
  assert.deepEqual(JSON.parse(json.stdout), input);
});

test('isolated kit renders rounded components and preserves signal/concat authoring', async () => {
  const input = JSON.parse(
    await readFile(new URL('../examples/processor-components.json', import.meta.url), 'utf8'),
  );
  const result = run(['-', '--output', '-', '--format', 'svg'], JSON.stringify(input));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, renderSvg(await layoutDiagram(createDiagramModel(input))) + '\n');
  assert.equal((result.stdout.match(/rx="12"/g) ?? []).length, 9);
  const starts = (result.stdout.match(/data-label-position="start"/g) ?? []).length;
  assert.equal(
    starts,
    input.connections.filter((c) => c.label !== undefined).length,
    'Each labeled Net has one source name',
  );
  assert.ok((result.stdout.match(/data-label-position="end"/g) ?? []).length >= 2);
  assert.doesNotMatch(result.stdout, /data-role="label-leader"/);
  assert.match(result.stdout, /data-label-position="end"/);
  assert.match(result.stdout, /<mask /);
  const json = run(['-', '--output', '-', '--format', 'json'], JSON.stringify(input));
  assert.equal(json.status, 0, json.stderr);
  assert.deepEqual(JSON.parse(json.stdout), input);
});

test('isolated CLI exports cross-group Grid JSON and aligned SVG with real group identity', async () => {
  const input = JSON.parse(
    await readFile(new URL('../examples/processor-cross-group-grid.json', import.meta.url), 'utf8'),
  );
  const json = run(['-', '--output', '-', '--format', 'json'], JSON.stringify(input));
  assert.equal(json.status, 0, json.stderr);
  assert.deepEqual(JSON.parse(json.stdout), input);
  const svg = run(['-', '--output', '-', '--format', 'svg'], JSON.stringify(input));
  assert.equal(svg.status, 0, svg.stderr);
  assert.equal(svg.stdout, renderSvg(await layoutDiagram(createDiagramModel(input))) + '\n');
  const scope = run(
    ['-', '--output', '-', '--format', 'svg', '--view', 'ComputeCluster'],
    JSON.stringify(input),
  );
  assert.equal(scope.status, 0, scope.stderr);
  assert.equal(
    scope.stdout,
    renderSvg(await layoutDiagram(createDiagramModel(input), { rootGroupId: 'ComputeCluster' })) + '\n',
  );
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

test('standalone Blockchart guide JSON examples validate and render without upstream examples', async () => {
  const readme = await readFile(join(kit, 'README.md'), 'utf8'),
    guide = readme.split('## Blockchart Agent Kit')[1].split('## Flowchart Agent Kit')[0],
    examples = [...guide.matchAll(/```json\r?\n([\s\S]*?)\r?\n```/g)];
  assert.equal(examples.length, 3);
  for (const match of examples) {
    const model = createDiagramModel(JSON.parse(match[1]));
    assert.ok(renderSvg(await layoutDiagram(model)).startsWith('<svg'));
  }
  assert.ok(!/\]\((?:\.\.\/|examples\/)/.test(readme));
  assert.ok(!readme.includes('{{KIT_VERSION}}'));
});
