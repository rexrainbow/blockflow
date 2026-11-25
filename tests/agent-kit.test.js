import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { join, dirname, basename, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildAgentKit } from '../scripts/build-agent-kit.js';
import { applyDiagramOps, createDiagramModel, layoutDiagram, renderSvg } from '../src/lib/index.js';

let directory, kit, cli, raw, built;
const names = [
  'README.md',
  'blockchart-convert.mjs',
  'blockchart-edit.mjs',
  'blockchart.schema.json',
  'flowchart-convert.mjs',
  'flowchart.schema.json',
  'statechart-convert.mjs',
  'statechart.schema.json',
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
  raw = JSON.parse(
    await readFile(new URL('../examples/blockchart/vertical-flow.json', import.meta.url), 'utf8'),
  );
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

function run(args, input, executable = cli) {
  // Restrict reads/writes to a temporary folder outside the checkout. A runtime
  // dependency on project files or node_modules must fail, rather than pass by accident.
  return spawnSync(
    process.execPath,
    [
      '--no-warnings',
      permissionFlag,
      `--allow-fs-read=${directory}`,
      `--allow-fs-write=${directory}`,
      executable,
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
    await readFile(new URL('../examples/blockchart/connection-labels.json', import.meta.url), 'utf8'),
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
    await readFile(new URL('../examples/blockchart/compact-layout.json', import.meta.url), 'utf8'),
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
    await readFile(new URL('../examples/blockchart/compact-labels.json', import.meta.url), 'utf8'),
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
    await readFile(
      new URL('../examples/blockchart/processor-cross-group-grid.json', import.meta.url),
      'utf8',
    ),
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
    await readFile(new URL('../examples/blockchart/default-styles.json', import.meta.url), 'utf8'),
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
  const input = JSON.parse(
    await readFile(new URL('../examples/blockchart/terminals.json', import.meta.url), 'utf8'),
  );
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
    await readFile(new URL('../examples/blockchart/port-adjustment.json', import.meta.url), 'utf8'),
  );
  await writeFile(join(directory, 'ports.json'), JSON.stringify(document));
  const svg = run(['ports.json', '--output', '-', '--format', 'svg']);
  assert.equal(svg.status, 0, svg.stderr);
  assert.equal(svg.stdout.trimEnd(), renderSvg(await layoutDiagram(createDiagramModel(document))));
  const json = run(['ports.json', '--output', '-', '--format', 'json']);
  assert.equal(json.status, 0, json.stderr);
  assert.deepEqual(JSON.parse(json.stdout), document);
});

test('eight matched artifacts are reproducible, current and contain no extra runtime files', async () => {
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
    await readFile(new URL('../examples/blockchart/processor-overview.json', import.meta.url), 'utf8'),
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
  const input = JSON.parse(
    await readFile(new URL('../examples/blockchart/partial-grid.json', import.meta.url), 'utf8'),
  );
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
    await readFile(new URL('../examples/blockchart/local-layout-spacing.json', import.meta.url), 'utf8'),
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
    await readFile(new URL('../examples/blockchart/auto-routing-channels.json', import.meta.url), 'utf8'),
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
    await readFile(new URL('../examples/blockchart/processor-components.json', import.meta.url), 'utf8'),
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
    await readFile(
      new URL('../examples/blockchart/processor-cross-group-grid.json', import.meta.url),
      'utf8',
    ),
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

test('isolated edit CLI previews and atomically applies the same diff; failures preserve input bytes', async () => {
  const file = join(directory, 'fanout.json'),
    edit = join(kit, 'blockchart-edit.mjs');
  const raw = JSON.parse(
    await readFile(new URL('../examples/blockchart/agent-edit-fanout.json', import.meta.url)),
  );
  const original = '\uFEFF' + JSON.stringify(raw, null, '\t').replaceAll('\n', '\r\n') + '\r\n';
  await writeFile(file, original);
  const remove = { op: 'removeBranch', from: 'TimerA.out', to: 'Sampler.in' };
  await writeFile(join(directory, 'ops.json'), JSON.stringify([remove]));
  const command = ['apply', 'fanout.json', '--ops', 'ops.json'];
  const preview = run(command, undefined, edit);
  assert.equal(preview.status, 0, preview.stderr);
  assert.deepEqual(JSON.parse(preview.stdout), applyDiagramOps(raw, [remove]).diff);
  assert.equal(await readFile(file, 'utf8'), original);
  const inspected = run(['inspect', 'fanout.json', '--group', 'Bank0', '--recursive'], undefined, edit);
  assert.equal(inspected.status, 0, inspected.stderr);
  assert.deepEqual(
    JSON.parse(inspected.stdout).branches.map((b) => b.relation),
    ['internal', 'outgoing'],
  );
  for (const [ops, error] of [
    [[remove, { ...remove, to: 'Unknown.in' }], /ops\[1\].*Unknown.in/],
    [[{ op: 'updateModule', id: 'TimerA', patch: { ports: [] } }], /Validation.*connections\[0\].*TimerA/],
  ]) {
    const bad = run(['apply', 'fanout.json', '--ops', '-', '--write'], JSON.stringify(ops), edit);
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, error);
    assert.equal(bad.stdout, '');
    assert.equal(await readFile(file, 'utf8'), original);
  }
  const lock = file + '.blockflow-edit.lock';
  await writeFile(lock, 'another writer');
  const busy = run([...command, '--write'], undefined, edit);
  assert.notEqual(busy.status, 0);
  assert.equal(await readFile(file, 'utf8'), original);
  assert.equal(await readFile(lock, 'utf8'), 'another writer');
  await rm(lock);
  const committed = run([...command, '--write'], undefined, edit);
  assert.equal(committed.status, 0, committed.stderr);
  assert.equal(committed.stdout, preview.stdout);
  const saved = await readFile(file, 'utf8');
  assert.ok(saved.startsWith('\uFEFF{\r\n\t'));
  assert.deepEqual(JSON.parse(saved.slice(1)).connections, [
    { ...raw.connections[0], to: [raw.connections[0].to[1]] },
  ]);
  assert.ok(!(await readdir(directory)).some((n) => n.startsWith('fanout.json.')));
  const noop = run(['apply', 'fanout.json', '--ops', '-', '--write'], '[]', edit);
  assert.equal(noop.status, 0, noop.stderr);
  assert.equal(noop.stdout.trim(), '[]');
  assert.equal(await readFile(file, 'utf8'), saved);
  const source = `import {inspectDiagram,applyDiagramOps,KIT_VERSION} from ${JSON.stringify(pathToFileURL(edit).href)};
    import assert from 'node:assert/strict'; const doc=${JSON.stringify(raw)};
    assert.equal(KIT_VERSION,${JSON.stringify(built.version)});
    assert.equal(inspectDiagram(doc,{moduleId:'TimerA'}).branches.length,2);
    assert.deepEqual(applyDiagramOps(doc,[${JSON.stringify(remove)}]).document.connections[0].to,[doc.connections[0].to[1]]);`;
  const api = spawnSync(
    process.execPath,
    ['--no-warnings', permissionFlag, `--allow-fs-read=${directory}`, '--input-type=module', '-e', source],
    { cwd: directory, encoding: 'utf8' },
  );
  assert.equal(api.status, 0, api.stderr);
  assert.equal(api.stdout, '');
  assert.equal(api.stderr, '');
});

test('standalone editor renames with identical preview/write diffs and atomic failures', async () => {
  const raw = JSON.parse(
    await readFile(new URL('../examples/blockchart/agent-edit-fanout.json', import.meta.url)),
  );
  const name = 'rename-edit.json',
    file = join(directory, name),
    edit = join(kit, 'blockchart-edit.mjs');
  const original = JSON.stringify(raw);
  await writeFile(file, original);
  const ops = [
    { op: 'renameModule', id: 'TimerA', newId: 'TickSource' },
    { op: 'updateModule', id: 'TickSource', patch: { label: 'Tick' } },
  ];
  const args = ['apply', name, '--ops', '-', '--diff-format', 'semantic'];
  const preview = run(args, JSON.stringify(ops), edit);
  assert.equal(preview.status, 0, preview.stderr);
  assert.equal(await readFile(file, 'utf8'), original);
  assert.deepEqual(JSON.parse(preview.stdout), applyDiagramOps(raw, ops, { diffFormat: 'semantic' }).diff);
  for (const bad of [
    { op: 'renameModule', id: 'Missing', newId: 'New' },
    { op: 'renameModule', id: 'TickSource', newId: 'Bank0' },
  ]) {
    const failed = run([...args, '--write'], JSON.stringify([...ops, bad]), edit);
    assert.notEqual(failed.status, 0);
    assert.match(failed.stderr, /ops\[2\] renameModule/);
    assert.equal(await readFile(file, 'utf8'), original);
  }
  const written = run([...args, '--write'], JSON.stringify(ops), edit);
  assert.equal(written.status, 0, written.stderr);
  assert.equal(written.stdout, preview.stdout);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), applyDiagramOps(raw, ops).document);
});

test('standalone editor uses the same semantic diff and diagram for preview and write', async () => {
  const raw = JSON.parse(
    await readFile(new URL('../examples/blockchart/agent-edit-fanout.json', import.meta.url)),
  );
  const name = 'semantic-edit.json',
    file = join(directory, name),
    edit = join(kit, 'blockchart-edit.mjs');
  const original = JSON.stringify(raw);
  await writeFile(file, original);
  const ops = [
    { op: 'updateNet', id: 'Clock', patch: { label: 'Tick' } },
    { op: 'updateBranch', from: 'TimerA.out', to: 'Sampler.in', patch: { style: { strokeWidth: 2 } } },
  ];
  const args = ['apply', name, '--ops', '-', '--diff-format', 'semantic'];
  const expected = applyDiagramOps(raw, ops, { diffFormat: 'semantic' });
  const preview = run(args, JSON.stringify(ops), edit);
  assert.equal(preview.status, 0, preview.stderr);
  assert.deepEqual(JSON.parse(preview.stdout), expected.diff);
  assert.deepEqual(
    expected.diff.map((r) => r.kind),
    ['net', 'branch'],
  );
  const invalid = run(
    ['apply', name, '--ops', '-', '--diff-format', 'bad', '--write'],
    JSON.stringify(ops),
    edit,
  );
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /diffFormat/);
  assert.equal(await readFile(file, 'utf8'), original);
  const written = run([...args, '--write'], JSON.stringify(ops), edit);
  assert.equal(written.status, 0, written.stderr);
  assert.equal(written.stdout, preview.stdout);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), expected.document);
  const repeat = run([...args, '--write'], JSON.stringify(ops), edit);
  assert.equal(repeat.status, 0, repeat.stderr);
  assert.deepEqual(JSON.parse(repeat.stdout), []);
});

test('standalone Blockchart guide JSON examples validate and render without upstream examples', async () => {
  const readme = await readFile(join(kit, 'README.md'), 'utf8'),
    guide = readme.split('## Blockchart Agent Kit')[1].split('## Flowchart Agent Kit')[0],
    examples = [...guide.matchAll(/```json\r?\n([\s\S]*?)\r?\n```/g)];
  const values = examples.map((match) => JSON.parse(match[1]));
  const diagrams = values.filter((value) => !Array.isArray(value));
  assert.equal(diagrams.length, 5);
  const operations = values.filter(Array.isArray);
  assert.equal(operations.length, 2);
  const sample = JSON.parse(
    await readFile(new URL('../examples/blockchart/agent-edit-fanout.json', import.meta.url)),
  );
  assert.deepEqual(
    diagrams.find((doc) => doc.diagram.name === sample.diagram.name),
    sample,
  );
  assert.deepEqual(applyDiagramOps(sample, operations[0]).document.connections[0].to, [
    sample.connections[0].to[1],
  ]);
  const edit = join(kit, 'blockchart-edit.mjs');
  const name = 'grid-net-example.json',
    file = join(directory, name);
  const original = JSON.stringify(sample);
  await writeFile(file, original);
  const command = ['apply', name, '--ops', '-'];
  const batch = operations[1];
  const preview = run(command, JSON.stringify(batch), edit);
  assert.equal(preview.status, 0, preview.stderr);
  assert.equal(await readFile(file, 'utf8'), original);
  const bad = run(
    [...command, '--write'],
    JSON.stringify([...batch, { op: 'setGridCells', id: 'Bank0', cells: [['Unknown']] }]),
    edit,
  );
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /Unknown.*setGridCells Bank0/);
  assert.equal(await readFile(file, 'utf8'), original);
  const written = run([...command, '--write'], JSON.stringify(batch), edit);
  assert.equal(written.status, 0, written.stderr);
  assert.equal(written.stdout, preview.stdout);
  const edited = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual(edited.groups[0], {
    id: 'Bank0',
    members: ['TimerA', 'Sampler', 'Monitor'],
    layout: {
      type: 'grid',
      cells: [
        ['TimerA', 'Sampler'],
        [null, 'Monitor'],
      ],
    },
  });
  assert.deepEqual(edited.connections, [
    {
      ...sample.connections[0],
      label: 'Sample clock',
      to: [
        { endpoint: 'Sampler.in', constraint: false, style: { strokeWidth: 2 } },
        sample.connections[0].to[1],
      ],
    },
  ]);
  for (const diagram of diagrams) {
    const model = createDiagramModel(diagram);
    assert.ok(renderSvg(await layoutDiagram(model)).startsWith('<svg'));
  }
  assert.ok(!/\]\((?:\.\.\/|examples\/)/.test(readme));
  assert.ok(!readme.includes('{{KIT_VERSION}}'));
});

test('isolated kit applies Grid Block minima to SVG and preserves authored JSON without backfilling', async () => {
  const input = JSON.parse(
    await readFile(new URL('../examples/blockchart/grid-block-minimums.json', import.meta.url), 'utf8'),
  );
  const saved = structuredClone(input);
  const svg = run(['-', '--output', '-', '--format', 'svg'], JSON.stringify(input));
  assert.equal(svg.status, 0, svg.stderr);
  assert.equal(svg.stdout, renderSvg(await layoutDiagram(createDiagramModel(input))) + '\n');
  const json = run(['-', '--output', '-', '--format', 'json'], JSON.stringify(input));
  assert.equal(json.status, 0, json.stderr);
  assert.deepEqual(JSON.parse(json.stdout), input);
  assert.ok(!Object.hasOwn(JSON.parse(json.stdout).modules[0], 'width'));
  assert.deepEqual(input, saved);
  const invalid = structuredClone(input);
  invalid.layout.blockMinWidth = 0;
  const bad = run(['-', '--check', '--diagnostics', 'json'], JSON.stringify(invalid));
  assert.equal(bad.status, 1);
  assert.equal(JSON.parse(bad.stderr).stage, 'validation');
  assert.equal(JSON.parse(bad.stderr).path, 'layout.blockMinWidth');
});
