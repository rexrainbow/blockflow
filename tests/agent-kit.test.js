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
  'docs',
  'flowchart-convert.mjs',
  'flowchart.schema.json',
  'licenses',
  'statechart-convert.mjs',
  'statechart.schema.json',
  'story-edit.mjs',
  'story.schema.json',
  'waveform-edit.mjs',
  'waveform.schema.json',
];
const guideNames = [
  'blockchart-edit.md',
  'blockchart.md',
  'flowchart.md',
  'statechart.md',
  'story.md',
  'waveform.md',
];
const artifacts = [
  ...names.filter((name) => !['docs', 'licenses'].includes(name)),
  ...guideNames.map((name) => 'docs/' + name),
  'licenses/elkjs-EPL-2.0.md',
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

test('tools, linked guides and license are reproducible and complete', async () => {
  assert.deepEqual((await readdir(kit)).sort(), names);
  assert.deepEqual((await readdir(join(kit, 'docs'))).sort(), guideNames);
  assert.deepEqual(await readdir(join(kit, 'licenses')), ['elkjs-EPL-2.0.md']);
  assert.match(built.version, /^blockchart-agent-kit-/);
  assert.match(built.flowchartVersion, /^flowchart-agent-kit-/);
  const help = run(['--help']);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /node blockchart-convert\.mjs/);
  for (const name of artifacts)
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

test('all generated local Markdown links resolve within the moved standalone kit', async () => {
  const markdown = artifacts.filter((name) => name.endsWith('.md'));
  const home = await readFile(join(kit, 'README.md'), 'utf8');
  assert.ok(home.split('\n').length < 120);
  for (const name of guideNames) assert.ok(home.includes(`](docs/${name})`));
  for (const file of markdown) {
    const text = await readFile(join(kit, file), 'utf8');
    assert.ok(!text.includes('{{'), file);
    for (const [, target] of text.matchAll(/\]\(([^)]+)\)/g)) {
      if (/^(https?:|mailto:)/.test(target)) continue;
      const path = resolve(dirname(join(kit, file)), decodeURIComponent(target.split('#')[0]));
      assert.ok(
        path.startsWith(resolve(kit) + (process.platform === 'win32' ? '\\' : '/')) || path === resolve(kit),
        `${file}: ${target}`,
      );
      assert.ok((await readFile(path)).length > 0, `${file}: ${target}`);
    }
  }
  assert.equal(
    lf(await readFile(join(kit, 'licenses/elkjs-EPL-2.0.md'), 'utf8')),
    lf(await readFile(new URL('../node_modules/elkjs/LICENSE.md', import.meta.url), 'utf8')),
  );
});

test('isolated Story CLI inspects and edits transactionally, with explicit missing-reference control', async () => {
  const executable = join(kit, 'story-edit.mjs');
  assert.equal(run(['--version'], undefined, executable).stdout.trim(), built.storyVersion);
  const diagram = JSON.parse(
    await readFile(new URL('../tests/fixtures/story/signal-path.json', import.meta.url)),
  );
  const story = JSON.parse(
    await readFile(new URL('../tests/fixtures/story/signal-path.story.json', import.meta.url)),
  );
  await writeFile(join(directory, 'story-diagram.json'), JSON.stringify(diagram));
  const original = '\uFEFF' + JSON.stringify(story, null, 2).replaceAll('\n', '\r\n') + '\r\n';
  const file = join(directory, 'draft.story.json');
  await writeFile(file, original);
  const inspect = run(['inspect', 'story-diagram.json', 'draft.story.json'], undefined, executable);
  assert.equal(inspect.status, 0, inspect.stderr);
  const index = JSON.parse(inspect.stdout);
  assert.equal(Object.keys(index.wires).length, 7);
  assert.ok(index.modules['@terminal:Pad']);
  assert.deepEqual(
    index.waveforms[0].signals.map((s) => s.id),
    ['tick', 'start'],
  );
  assert.deepEqual(
    index.waveforms[0].edges.map((e) => e.id),
    ['timer_tick', 'start_edge'],
  );
  assert.equal(index.waveforms[0].links[0].ref, 'timer_tick -> start_edge');
  assert.equal(index.waveforms[0].markers[0].id, 'packet');
  assert.deepEqual(index.waveforms[1], { ci: 1, signals: [], edges: [], links: [], markers: [] });
  const args = ['edit', 'story-diagram.json', 'draft.story.json', '--ops', '-'];
  const ops = [{ op: 'replace', path: '/chapters/0/steps/0/title', value: 'Clock starts the timer' }];
  const preview = run(args, JSON.stringify(ops), executable);
  assert.equal(preview.status, 0, preview.stderr);
  assert.equal(await readFile(file, 'utf8'), original);
  const invalid = run(
    [...args, '--write'],
    JSON.stringify([...ops, { op: 'remove', path: '/chapters/99' }]),
    executable,
  );
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /ops\[1\].*chapters\/99/);
  assert.equal(await readFile(file, 'utf8'), original);
  const missing = [
    { op: 'add', path: '/chapters/0/steps/0/notes', value: [{ module: 'Missing', text: 'Note' }] },
  ];
  assert.equal(run([...args, '--write'], JSON.stringify(missing), executable).status, 1);
  assert.equal(await readFile(file, 'utf8'), original);
  const written = run([...args, '--write'], JSON.stringify(ops), executable);
  assert.equal(written.status, 0, written.stderr);
  assert.equal(written.stdout, preview.stdout);
  const saved = await readFile(file, 'utf8');
  assert.ok(saved.startsWith('\uFEFF'));
  assert.ok(saved.endsWith('\r\n'));
  const allowed = run([...args, '--allow-missing', '--write'], JSON.stringify(missing), executable);
  assert.equal(allowed.status, 0, allowed.stderr);
  assert.equal(JSON.parse(allowed.stdout).problems[0].ref, 'Missing');
  const check = run(['check', 'story-diagram.json', 'draft.story.json'], undefined, executable);
  assert.equal(check.status, 1);
  assert.equal(JSON.parse(check.stdout)[0].ref, 'Missing');
});

test('isolated Story HTML matches GUI page assembly and extracts both escaped sources', async () => {
  const executable = join(kit, 'story-edit.mjs');
  const diagram = JSON.parse(
    await readFile(new URL('../tests/fixtures/story/signal-path.json', import.meta.url)),
  );
  const { parseStory, presentationData, readPresentationSources } = await import('../src/lib/story/model.js');
  const story = parseStory(
    JSON.parse(await readFile(new URL('../tests/fixtures/story/signal-path.story.json', import.meta.url))),
  );
  story.title = 'Title </script> \u2028 \u2029';
  story.chapters[0].steps[0].body = '<b>Text</b>';
  await writeFile(join(directory, 'page-diagram.json'), JSON.stringify(diagram));
  await writeFile(join(directory, 'page.story.json'), JSON.stringify(story));
  const assets = await Promise.all(
    ['player.js', 'present.js', 'player.css', 'present.css'].map((file) =>
      readFile(new URL('../src/story/' + file, import.meta.url), 'utf8'),
    ),
  );
  const assembly = (await readFile(new URL('../src/story/export.js', import.meta.url), 'utf8'))
    .replace(/^import .*$/gm, '')
    .replace(/^export /gm, '');
  const guiHtml = new Function(
    'playerJs',
    'presentJs',
    'playerCss',
    'presentCss',
    'SOURCES_ID',
    assembly + '\nreturn presentationHtml;',
  )(...assets, 'blockflow-sources');
  const svg = renderSvg(await layoutDiagram(createDiagramModel(diagram)));
  const expected = guiHtml(presentationData({ svg, story }), { diagram, story });
  const exported = run(
    ['export', 'page-diagram.json', 'page.story.json', '-o', 'page.html'],
    undefined,
    executable,
  );
  assert.equal(exported.status, 0, exported.stderr);
  const html = await readFile(join(directory, 'page.html'), 'utf8');
  assert.equal(html, expected);
  assert.ok(html.includes('\\u003c'));
  assert.ok(html.includes('\\u2028'));
  assert.ok(html.includes('\\u2029'));
  const extracted = run(['extract', 'page.html'], undefined, executable);
  assert.equal(extracted.status, 0, extracted.stderr);
  assert.deepEqual(JSON.parse(extracted.stdout), { diagram, story });
  assert.deepEqual(readPresentationSources(html), { diagram, story });
  const protectedSource = await readFile(join(directory, 'page.story.json'), 'utf8');
  assert.equal(
    run(['export', 'page-diagram.json', 'page.story.json', '-o', 'page.story.json'], undefined, executable)
      .status,
    1,
  );
  assert.equal(await readFile(join(directory, 'page.story.json'), 'utf8'), protectedSource);
  const probe = `import assert from 'node:assert/strict';import fs from 'node:fs';import {parseStory,emptyStory,applyStoryOps,inspectStory,checkStory,editStory,exportStory,readPresentationSources} from ${JSON.stringify(pathToFileURL(executable).href)}; const d=JSON.parse(fs.readFileSync('page-diagram.json'));const s=JSON.parse(fs.readFileSync('page.story.json'));assert.deepEqual(await checkStory(d,s),[]);assert.equal((await inspectStory(d)).fingerprint.length,16);const e=await editStory(d,s,[{op:'replace',path:'/title',value:'New'}]);assert.equal(e.document.title,'New');assert.equal(readPresentationSources(await exportStory(d,s)).story.title,s.title);assert.equal(emptyStory().format,'blockflow-story');assert.throws(()=>parseStory({version:2,chapters:[]}));assert.equal(typeof applyStoryOps,'function');`;
  await writeFile(join(directory, 'story-probe.mjs'), probe);
  const api = run([], undefined, join(directory, 'story-probe.mjs'));
  assert.equal(api.status, 0, api.stderr);
  assert.equal(api.stdout, '');
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
  const guide =
      (await readFile(join(kit, 'docs/blockchart.md'), 'utf8')) +
      '\n' +
      (await readFile(join(kit, 'docs/blockchart-edit.md'), 'utf8')),
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
  assert.ok(guide.includes('](../README.md)'));
  assert.ok(!guide.includes('{{KIT_VERSION}}'));
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

test('isolated Story waveform edits keep preview/write parity and preserve failed batches', async () => {
  const executable = join(kit, 'story-edit.mjs');
  const diagram = await readFile(new URL('./fixtures/story/signal-path.json', import.meta.url), 'utf8');
  const story = JSON.parse(
    await readFile(new URL('./fixtures/story/signal-path.story.json', import.meta.url), 'utf8'),
  );
  const file = join(directory, 'waveform.story.json');
  await writeFile(join(directory, 'waveform-diagram.json'), diagram);
  const original = JSON.stringify(story, null, 2) + '\n';
  await writeFile(file, original);
  const args = ['edit', 'waveform-diagram.json', 'waveform.story.json', '--ops', '-'];
  const batch = [
    { op: 'replace', path: '/chapters/0/waveform/signals/0/id', value: 'renamed_tick' },
    { op: 'replace', path: '/chapters/0/steps/0/waveform/signals/0', value: 'renamed_tick' },
    { op: 'add', path: '/chapters/0/steps/0/waveform/markers', value: ['packet'] },
  ];
  const failed = run([...args, '--write'], JSON.stringify(batch.slice(0, 1)), executable);
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /signal tick/);
  assert.equal(await readFile(file, 'utf8'), original);
  const invalid = run(
    [...args, '--write'],
    JSON.stringify([{ op: 'replace', path: '/chapters/0/waveform/signals/0/width', value: 0 }]),
    executable,
  );
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /ops\[0\].*waveform.signals\[0\].width/);
  assert.equal(await readFile(file, 'utf8'), original);
  const preview = run(args, JSON.stringify(batch), executable);
  assert.equal(preview.status, 0, preview.stderr);
  assert.equal(await readFile(file, 'utf8'), original);
  const written = run([...args, '--write'], JSON.stringify(batch), executable);
  assert.equal(written.status, 0, written.stderr);
  assert.equal(written.stdout, preview.stdout);
  const saved = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(saved.chapters[0].waveform.signals[0].id, 'renamed_tick');
  assert.equal(saved.chapters[0].waveform.links[0].locked, true);
  const broken = [
    {
      op: 'replace',
      path: '/chapters/0/steps/0/waveform',
      value: { from: 0, to: 17, signals: ['absent'], links: ['bad -> edge'], markers: ['missing'] },
    },
    { op: 'add', path: '/chapters/1/steps/0/waveform', value: {} },
  ];
  const allowed = run([...args, '--allow-missing', '--write'], JSON.stringify(broken), executable);
  assert.equal(allowed.status, 0, allowed.stderr);
  assert.deepEqual(
    JSON.parse(allowed.stdout).problems.map((p) => p.type),
    ['window', 'signal', 'link', 'marker', 'waveform'],
  );
  const check = run(['check', 'waveform-diagram.json', 'waveform.story.json'], undefined, executable);
  assert.equal(check.status, 1);
  assert.deepEqual(JSON.parse(check.stdout), JSON.parse(allowed.stdout).problems);
  const exported = run(
    ['export', 'waveform-diagram.json', 'waveform.story.json', '-o', 'waveform-page.html'],
    undefined,
    executable,
  );
  assert.equal(exported.status, 0, exported.stderr);
  const html = await readFile(join(directory, 'waveform-page.html'), 'utf8');
  const data = JSON.parse(/<script type="application\/json" id="pv-data">([\s\S]*?)<\/script>/.exec(html)[1]);
  assert.equal(data.chapters[0].waveformView.portWires.start.length, 2);
  assert.match(data.chapters[0].waveformView.svg, /blockflow-story-waveform-0/);
  assert.equal(data.chapters[0].waveformView.lanes.renamed_tick, 92);
  assert.deepEqual(data.problems, JSON.parse(check.stdout));
  const extracted = run(['extract', 'waveform-page.html'], undefined, executable);
  assert.equal(extracted.status, 0, extracted.stderr);
  assert.deepEqual(JSON.parse(extracted.stdout).story, JSON.parse(await readFile(file, 'utf8')));
  const { default: Ajv2020 } = await import('ajv/dist/2020.js');
  const schema = JSON.parse(await readFile(join(kit, 'story.schema.json'), 'utf8'));
  const waveSchema = JSON.parse(await readFile(join(kit, 'waveform.schema.json'), 'utf8'));
  const validate = new Ajv2020({ strict: false }).addSchema(waveSchema).compile(schema);
  assert.equal(validate(JSON.parse(extracted.stdout).story), true, JSON.stringify(validate.errors));
});

test('standalone Waveform CLI previews, writes atomically and preserves draft diagnostics', async () => {
  const executable = join(kit, 'waveform-edit.mjs');
  assert.equal(run(['--version'], undefined, executable).stdout.trim(), built.waveformVersion);
  assert.match(run(['--help'], undefined, executable).stdout, /import-vcd/);
  const raw = JSON.parse(await readFile(new URL('./fixtures/waveform/dshot.json', import.meta.url), 'utf8'));
  const file = join(directory, 'timing.json');
  const original = '\uFEFF' + JSON.stringify(raw, null, 2).replaceAll('\n', '\r\n') + '\r\n';
  await writeFile(file, original);
  const inspect = run(['inspect', 'timing.json'], undefined, executable);
  assert.equal(inspect.status, 0, inspect.stderr);
  assert.equal(JSON.parse(inspect.stdout).edges[0].id, 'clock_start');
  assert.deepEqual(JSON.parse(inspect.stdout).problems, []);
  const batch = [{ op: 'moveEdge', signalId: 'tx', t: 6, to: 5 }];
  const args = ['apply', 'timing.json', '--ops', '-'];
  const preview = run(args, JSON.stringify(batch), executable);
  assert.equal(preview.status, 0, preview.stderr);
  assert.equal(await readFile(file, 'utf8'), original);
  const failed = run(
    [...args, '--write'],
    JSON.stringify([...batch, { op: 'moveEdge', edgeId: 'absent', to: 3 }]),
    executable,
  );
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /ops\[1\].*absent/);
  assert.equal(await readFile(file, 'utf8'), original);
  const lock = file + '.blockflow-edit.lock';
  await writeFile(lock, 'test lock');
  assert.equal(run([...args, '--write'], JSON.stringify(batch), executable).status, 1);
  assert.equal(await readFile(file, 'utf8'), original);
  await rm(lock);
  const written = run([...args, '--write'], JSON.stringify(batch), executable);
  assert.equal(written.status, 0, written.stderr);
  assert.equal(written.stdout, preview.stdout);
  const saved = await readFile(file, 'utf8');
  assert.ok(saved.startsWith('\uFEFF'));
  assert.ok(saved.endsWith('\r\n'));
  assert.equal(JSON.parse(saved.slice(1)).signals[3].changes[1][0], 5);
  const missing = JSON.stringify([{ op: 'setLinks', links: [{ from: 'absent', to: 'hi_start' }] }]);
  assert.equal(run([...args, '--write'], missing, executable).status, 1);
  assert.equal(await readFile(file, 'utf8'), saved);
  const draft = run(
    ['edit', 'timing.json', '--ops', '-', '--allow-problems', '--write'],
    missing,
    executable,
  );
  assert.equal(draft.status, 0, draft.stderr);
  assert.equal(JSON.parse(draft.stdout).problems[0].code, 'MISSING_EDGE');
  const check = run(['check', 'timing.json'], undefined, executable);
  assert.equal(check.status, 1);
  assert.deepEqual(JSON.parse(check.stdout), JSON.parse(draft.stdout).problems);
  assert.deepEqual(
    (await readdir(directory)).filter((n) => n.endsWith('.tmp') || n.endsWith('.lock')),
    [],
  );
});

test('standalone Waveform exports match runtime and VCD commands protect sources', async () => {
  const executable = join(kit, 'waveform-edit.mjs');
  const api = await import('../src/lib/waveform/index.js');
  const raw = JSON.parse(await readFile(new URL('./fixtures/waveform/dshot.json', import.meta.url), 'utf8'));
  await writeFile(join(directory, 'export-wave.json'), JSON.stringify(raw));
  const svg = run(
    ['export', 'export-wave.json', '-o', '-', '--from', '8', '--to', '16', '--id-prefix', 'test-wave'],
    undefined,
    executable,
  );
  assert.equal(svg.status, 0, svg.stderr);
  assert.equal(svg.stdout, api.renderWaveformSvg(raw, { from: 8, to: 16, idPrefix: 'test-wave' }) + '\n');
  const rail = run(['export', 'export-wave.json', '-o', '-', '--link-route', 'rail'], undefined, executable);
  assert.equal(rail.status, 0, rail.stderr);
  assert.equal(rail.stdout, api.renderWaveformSvg(raw, { linkRoute: 'rail' }) + '\n');
  const normalized = run(
    ['export', 'export-wave.json', '--format', 'json', '-o', '-'],
    undefined,
    executable,
  );
  assert.deepEqual(JSON.parse(normalized.stdout), api.parseWaveform(raw));
  const original = await readFile(join(directory, 'export-wave.json'), 'utf8');
  assert.equal(
    run(['export', 'export-wave.json', '-o', 'export-wave.json'], undefined, executable).status,
    1,
  );
  assert.equal(await readFile(join(directory, 'export-wave.json'), 'utf8'), original);
  await writeFile(join(directory, 'wave.svg'), 'keep');
  assert.equal(
    run(['export', 'export-wave.json', '-o', 'wave.svg', '--from', '0.5'], undefined, executable).status,
    1,
  );
  assert.equal(await readFile(join(directory, 'wave.svg'), 'utf8'), 'keep');
  const vcd = await readFile(new URL('./fixtures/waveform/small.vcd', import.meta.url), 'utf8');
  await writeFile(join(directory, 'capture.vcd'), vcd);
  const listed = run(['vcd-list', 'capture.vcd'], undefined, executable);
  assert.equal(listed.status, 0, listed.stderr);
  assert.deepEqual(JSON.parse(listed.stdout), api.listVcdSignals(vcd));
  const imported = run(
    ['import-vcd', 'capture.vcd', '--signals', 'top.data', '--from', '2', '--to', '8'],
    undefined,
    executable,
  );
  assert.equal(imported.status, 0, imported.stderr);
  assert.deepEqual(
    JSON.parse(imported.stdout),
    api.importVcd(vcd, { signals: ['top.data'], from: 2, to: 8 }),
  );
  assert.equal(run(['vcd-list', 'capture.vcd', '--max-bytes', '10'], undefined, executable).status, 1);
  assert.equal(run(['import-vcd', 'capture.vcd', '--signals', 'absent'], undefined, executable).status, 1);
  assert.equal(run(['import-vcd', 'capture.vcd', '-o', 'capture.vcd'], undefined, executable).status, 1);
  assert.equal(await readFile(join(directory, 'capture.vcd'), 'utf8'), vcd);
  const probe = `import fs from 'node:fs';import assert from 'node:assert/strict';import * as w from ${JSON.stringify(pathToFileURL(executable).href)};const raw=JSON.parse(fs.readFileSync('export-wave.json'));const saved=structuredClone(raw);const r=w.applyWaveformOps(raw,[{op:'moveEdge',signalId:'tx',t:6,to:5}]);assert.deepEqual(raw,saved);assert.equal(w.inspectWaveform(r.document).document.signals[3].changes[1][0],5);assert.equal(w.snapWaveformTime(raw,5,'bit'),8);assert.ok(w.layoutWaveform(raw).lanes.length);assert.equal(w.validateWaveform(raw).ok,true);assert.equal(typeof w.renderWaveformSvg,'function');assert.equal(typeof w.importVcd,'function');assert.equal(typeof w.listVcdSignals,'function');`;
  await writeFile(join(directory, 'wave-probe.mjs'), probe);
  const result = run([], undefined, join(directory, 'wave-probe.mjs'));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
});
