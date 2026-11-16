import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, basename } from 'node:path';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import Ajv from 'ajv/dist/2020.js';
import sharp from 'sharp';
import { DOMParser } from '@xmldom/xmldom';
import * as flow from 'rtl-diagram/flowchart';
import * as nodeApi from 'rtl-diagram/flowchart/node';
import * as block from 'rtl-diagram/blockchart';
import * as legacy from 'rtl-diagram';
import { textSize } from '../../src/lib/shared/text.js';

const source = await readFile(new URL('../../examples/flowchart/batch-update.mmd', import.meta.url), 'utf8');
const validate = new Ajv({ strict: true, allErrors: true }).compile(
  JSON.parse(await readFile(new URL('../../schema/flowchart.schema.json', import.meta.url), 'utf8')),
);
const frozen = (o) => {
  if (o && typeof o === 'object') {
    for (const value of Object.values(o)) frozen(value);
    Object.freeze(o);
  }
  return o;
};
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-5, `${a} != ${b}`);
const intersects = (a, b, r) =>
  Math.abs(a.y - b.y) < 1e-6
    ? a.y > r.y + 1e-6 &&
      a.y < r.y + r.height - 1e-6 &&
      Math.max(a.x, b.x) > r.x + 1e-6 &&
      Math.min(a.x, b.x) < r.x + r.width - 1e-6
    : a.x > r.x + 1e-6 &&
      a.x < r.x + r.width - 1e-6 &&
      Math.max(a.y, b.y) > r.y + 1e-6 &&
      Math.min(a.y, b.y) < r.y + r.height - 1e-6;
function geometry(result) {
  assert.ok(
    Number.isFinite(result.width) && result.width > 0 && Number.isFinite(result.height) && result.height > 0,
  );
  for (const n of result.nodes) {
    assert.ok(
      n.x >= 0 && n.y >= 0 && n.x + n.width <= result.width + 1e-6 && n.y + n.height <= result.height + 1e-6,
    );
  }
  for (const edge of result.edges)
    for (const section of edge.sections)
      for (let i = 1; i < section.points.length; i++) {
        const a = section.points[i - 1],
          b = section.points[i];
        assert.ok(Math.abs(a.x - b.x) < 1e-6 || Math.abs(a.y - b.y) < 1e-6, 'orthogonal route');
        for (const n of result.nodes) assert.ok(!intersects(a, b, n), `${edge.id} crosses ${n.id}`);
        for (const p of [a, b])
          assert.ok(p.x >= 0 && p.y >= 0 && p.x <= result.width && p.y <= result.height);
      }
}

test('Mermaid batch fixture compiles into stable portable JSON and infers a loop without mutating the document', async () => {
  const document = flow.parseMermaid(source),
    saved = JSON.parse(
      await readFile(new URL('../../examples/flowchart/batch-update.json', import.meta.url), 'utf8'),
    );
  assert.deepEqual(document, saved);
  assert.equal(validate(document), true, JSON.stringify(validate.errors));
  const before = structuredClone(document),
    model = flow.createFlowchartModel(frozen(document)),
    snapshot = structuredClone(model);
  assert.equal(model.nodes.length, 7);
  assert.equal(model.edges.length, 7);
  assert.equal(model.edges.filter((e) => e.kind === 'loop').length, 1);
  const result = await flow.layoutFlowchart(frozen(model));
  geometry(result);
  assert.deepEqual(model, snapshot);
  assert.deepEqual(document, before);
  assert.deepEqual(await flow.layoutFlowchart(model), result);
  assert.deepEqual(await flow.layoutFlowchart(document), result);
  const node = (id) => result.nodes.find((n) => n.id === id),
    loop = result.edges.find((e) => e.kind === 'loop');
  assert.equal(loop.label, 'Yes');
  assert.equal(loop.fromSide, 'left');
  assert.equal(loop.toSide, 'left');
  assert.ok(Math.min(...loop.sections[0].points.map((p) => p.x)) < node('StageWrite').x);
  assert.ok(node('Settings').x > node('StageWrite').x + node('StageWrite').width);
  near(
    node('Settings').y + node('Settings').height / 2,
    node('StageWrite').y + node('StageWrite').height / 2,
  );
  const sequence = ['Start', 'EnterHold', 'StageWrite', 'MoreWrites', 'Commit', 'Complete'];
  for (let i = 1; i < sequence.length; i++) assert.ok(node(sequence[i]).y > node(sequence[i - 1]).y);
  assert.equal(result.warnings, undefined);
  const no = result.edges.find((e) => e.label === 'No'),
    yes = loop;
  assert.ok(no.labelBounds.y > node('MoreWrites').y + node('MoreWrites').height);
  assert.ok(
    yes.sections.some(({ points }) =>
      points.slice(1).some((b, i) => {
        const a = points[i],
          p = yes.labelPosition;
        return (
          (Math.abs(a.x - b.x) < 1e-6 &&
            Math.abs(p.x - a.x) < 1e-6 &&
            p.y >= Math.min(a.y, b.y) &&
            p.y <= Math.max(a.y, b.y)) ||
          (Math.abs(a.y - b.y) < 1e-6 &&
            Math.abs(p.y - a.y) < 1e-6 &&
            p.x >= Math.min(a.x, b.x) &&
            p.x <= Math.max(a.x, b.x))
        );
      }),
    ),
  );
  // The note detour must not create out-and-back spurs on the loop lane.
  const points = loop.sections[0].points;
  for (let i = 2; i < points.length; i++) {
    const [a, b, c] = points.slice(i - 2, i + 1);
    assert.ok((b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y) >= -1e-6);
  }
});

for (const direction of ['TD', 'LR', 'BT', 'RL'])
  test(`Direction ${direction}, branches, nested groups and disconnected nodes stay valid`, async () => {
    const doc = flow.parseMermaid(
      `flowchart ${direction}\nsubgraph outer["Outer group"]\nsubgraph inner["Inner group"]\nA["Input"] --> B{"Choose?"}\nend\nB -->|Yes| C["Accept"]\nB -->|No| D["Reject"]\nend\nIsolated["Unrelated"]`,
    );
    assert.equal(validate(doc), true, JSON.stringify(validate.errors));
    doc.groups.reverse();
    const result = await flow.layoutFlowchart(doc);
    geometry(result);
    assert.equal(result.groups.length, 2);
    assert.deepEqual(
      result.groups.map((g) => g.id),
      ['outer', 'inner'],
    );
    assert.equal(result.nodes.length, 5);
    // Short branches can require the documented beside-wire fallback.
    assert.deepEqual(
      result.warnings?.map((w) => ({ code: w.code, edgeId: w.edgeId })),
      direction === 'BT' ? undefined : [{ code: 'FLOW_LABEL_OVERLAP', edgeId: 'edge_3' }],
    );
    if (result.warnings) assert.match(result.warnings[0].message, /placed beside its wire/);
    const [a, b] = ['A', 'B'].map((id) => result.nodes.find((n) => n.id === id));
    assert.ok(
      direction === 'TD'
        ? b.y > a.y
        : direction === 'BT'
          ? b.y < a.y
          : direction === 'LR'
            ? b.x > a.x
            : b.x < a.x,
    );
    for (const g of result.groups)
      for (const id of g.members) {
        const n = [...result.nodes, ...result.groups].find((n) => n.id === id);
        assert.ok(
          n.x >= g.x &&
            n.y >= g.y &&
            n.x + n.width <= g.x + g.width + 1e-6 &&
            n.y + n.height <= g.y + g.height + 1e-6,
        );
      }
  });

test('All loop sides, grouped notes, self-loops and conditions produce clear routes', async () => {
  for (const [direction, side] of [
    ['down', 'left'],
    ['down', 'right'],
    ['right', 'top'],
    ['right', 'bottom'],
  ]) {
    const doc = flow.parseMermaid(
      'flowchart TD\nsubgraph G["Loop"]\nA["First"] --> B{"Again?"}\nB -->|Yes| A\nB -->|No| C(["Done"])\nN@{shape:doc,label:"Help"}\nA -.- N\nend',
    );
    doc.layout = { direction, loopSide: side };
    const result = await flow.layoutFlowchart(doc);
    geometry(result);
    assert.equal(result.edges.find((e) => e.kind === 'loop').fromSide, side);
  }
  const result = await flow.layoutFlowchart(flow.parseMermaid('flowchart TD\nA["Retry"] -->|Again| A'));
  geometry(result);
  assert.ok(result.edges[0].sections[0].points.length >= 4);
});

test('Styles, declarations, quoted delimiters, Unicode, chains and Markdown line breaks survive text parsing', () => {
  const doc = flow.parseMermaid(
    '%% comment\ngraph LR; A["A ] & <x><br/>第二行"]:::blue -->|go| B(["End"]);\nstyle A stroke-width:2\nclassDef blue fill:#abc,color:#123\nclassDef default font-size:14\nlinkStyle default stroke:#789\nlinkStyle 0 stroke-width:3\nB["Updated"]',
  );
  const model = flow.createFlowchartModel(doc);
  assert.equal(model.nodes[0].label, 'A ] & <x>\n第二行');
  assert.equal(model.nodes[0].style.fillColor, '#aabbcc');
  assert.equal(model.nodes[0].style.borderWidth, 2);
  assert.equal(model.nodes[0].style.fontSize, 14);
  assert.equal(model.nodes[1].label, 'Updated');
  assert.equal(model.nodes[1].type, 'process');
  assert.equal(model.edges[0].style.strokeWidth, 3);
  const pathText = flow.parseMermaid(String.raw`flowchart TD
A["C:\\new\\commands.json"] --> B["Line one\nLine two"]`);
  assert.equal(pathText.nodes[0].label, String.raw`C:\new\commands.json`);
  assert.equal(pathText.nodes[1].label, 'Line one\nLine two');
  assert.throws(
    () => flow.parseMermaid('flowchart TD\nA["Bad"]\nstyle A fill:red'),
    (e) => e instanceof flow.MermaidSyntaxError && e.line === 2,
  );
});

for (const bad of [
  'flowchart TD\nA["unclosed"',
  'flowchart TD\nclick A callback',
  'flowchart TD\nA & B --> C',
  'flowchart TD\nA --> B\nlinkStyle 9 stroke:#fff',
  'flowchart TD\nsubgraph G\nA',
  'flowchart TD\nA:::missing',
  'flowchart TD\nA@{shape:alien}',
  '%%{init:{}}%%\nflowchart TD\nA',
])
  test('Unsupported or invalid Mermaid reports source location: ' + bad.slice(0, 45), () => {
    assert.throws(
      () => flow.parseMermaid(bad),
      (e) =>
        e instanceof flow.MermaidSyntaxError &&
        e.line > 0 &&
        e.column > 0 &&
        /line \d+, column \d+/.test(e.message),
    );
  });

test('Strict model validates references, notes, group membership, style values and loop hints', () => {
  const base = () => flow.parseMermaid('flowchart TD\nA --> B');
  for (const change of [
    (d) => (d.nodes[0].style = { fillColor: 'red' }),
    (d) => (d.edges[0].to = 'missing'),
    (d) => (d.edges[0].arrow = 1),
    (d) => d.nodes.push({ ...d.nodes[0] }),
    (d) => (d.nodes[0].width = 0),
    (d) => (d.nodes[0].style = { fontSize: Infinity }),
    (d) => (d.layout.loopSide = 'bottom'),
    (d) => d.nodes.push({ id: 'Note', type: 'note' }),
    (d) =>
      (d.groups = [
        { id: 'G', members: ['A'] },
        { id: 'H', members: ['A'] },
      ]),
    (d) =>
      (d.groups = [
        { id: 'G', members: ['H'] },
        { id: 'H', members: ['G'] },
      ]),
    (d) => (d.layout.x = 10),
  ]) {
    const doc = base();
    change(doc);
    assert.throws(() => flow.createFlowchartModel(doc), flow.FlowchartValidationError);
  }
  for (const partial of [{ width: 0 }, { style: { fillColor: 'red' } }, { type: 'unknown' }]) {
    const doc = base();
    Object.assign(doc.nodes[0], partial);
    assert.equal(validate(doc), false);
  }
});

test('SVG safely escapes labels, draws distinct shapes and rasterizes standalone without browser resources', async () => {
  const doc = flow.parseMermaid(source);
  doc.nodes[0].label = '<script>alert("x")</script> & Unicode 測試';
  doc.diagram.caption = 'Standalone SVG\nSecond line';
  const result = await flow.layoutFlowchart(doc),
    svg = flow.renderFlowchartSvg(result);
  assert.ok(!svg.includes('<script>'));
  assert.match(svg, /&lt;script&gt;/);
  assert.ok(!svg.includes('foreignObject'));
  const xml = new DOMParser().parseFromString(svg, 'image/svg+xml');
  assert.equal(xml.documentElement.localName, 'svg');
  const png = await sharp(Buffer.from(svg)).png().toBuffer(),
    metadata = await sharp(png).metadata();
  assert.equal(metadata.format, 'png');
  assert.equal(metadata.width, Math.round(result.width));
  const decision = result.nodes.find((n) => n.type === 'decision'),
    size = textSize(decision.label, decision.style);
  assert.ok(
    (size.width / 2 + decision.style.padding) / (decision.width / 2) +
      (size.height / 2 + decision.style.padding) / (decision.height / 2) <=
      1,
  );
});

test('Thick strokes and arrow wings stay inside the exported canvas', async () => {
  const doc = flow.parseMermaid('flowchart TD\nA --> B');
  doc.diagram.style = { edge: { strokeWidth: 80 } };
  doc.layout.layerSpacing = 600;
  const layout = await flow.layoutFlowchart(doc);
  for (const edge of layout.edges)
    for (const p of edge.sections.flatMap((s) => s.points)) {
      const half = edge.style.strokeWidth * 1.5;
      assert.ok(
        p.x - half >= 0 && p.x + half <= layout.width && p.y - half >= 0 && p.y + half <= layout.height,
      );
    }
  assert.equal(
    (
      await sharp(Buffer.from(flow.renderFlowchartSvg(layout)))
        .png()
        .toBuffer()
    ).length > 0,
    true,
  );
});

test('Author IDs cannot collide with internal ELK root, edge or attachment IDs', async () => {
  const doc = flow.parseMermaid('flowchart TD\nflowchart_root --> edge_1_from --> edge_1_to');
  doc.edges[0].id = 'flowchart_root';
  const result = await flow.layoutFlowchart(doc);
  geometry(result);
  assert.deepEqual(
    result.nodes.map((n) => n.id),
    ['flowchart_root', 'edge_1_from', 'edge_1_to'],
  );
  assert.equal(result.edges[0].id, 'flowchart_root');
});

test('Blockchart facades preserve identity; Flowchart core and Node entries remain separate', async () => {
  assert.deepEqual(legacy, block);
  for (const key of Object.keys(flow)) assert.equal(nodeApi[key], flow[key]);
  assert.equal(flow.exportPng, undefined);
  const script = `import {register} from 'node:module';register('data:text/javascript,'+encodeURIComponent('export async function resolve(s,c,n){if(s.includes("blockchart")||s==="sharp"||s.startsWith("node:fs"))throw new Error("Forbidden dependency "+s);return n(s,c)}'),import.meta.url);const f=await import('rtl-diagram/flowchart');const r=await f.layoutFlowchart(f.parseMermaid('flowchart TD\\nA --> B'));if(!f.renderFlowchartSvg(r).startsWith('<svg'))throw new Error('SVG failed');`;
  await promisify(execFile)(process.execPath, ['--input-type=module', '--eval', script]);
});

test('CLI converts text and JSON, exports SVG/PNG, reports errors and protects input', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'flowchart-runtime-'));
  const run = promisify(execFile),
    cli = new URL('../../scripts/flowchart-convert.js', import.meta.url);
  try {
    const input = new URL('../../examples/flowchart/batch-update.mmd', import.meta.url).pathname.replace(
      /^\/(?=[A-Za-z]:)/,
      '',
    );
    const json = join(directory, 'graph.json'),
      svg = join(directory, 'graph.svg'),
      png = join(directory, 'graph.png');
    await run(process.execPath, [cli.pathname.replace(/^\/(?=[A-Za-z]:)/, ''), input, '--output', json]);
    await run(process.execPath, [cli.pathname.replace(/^\/(?=[A-Za-z]:)/, ''), json, '--output', svg]);
    await run(process.execPath, [
      cli.pathname.replace(/^\/(?=[A-Za-z]:)/, ''),
      json,
      '--output',
      png,
      '--scale',
      '1.5',
    ]);
    const document = JSON.parse(await readFile(json, 'utf8'));
    assert.deepEqual(document, flow.parseMermaid(source));
    assert.ok(!(await readFile(svg, 'utf8')).includes('data-hit'));
    assert.equal((await sharp(png).metadata()).format, 'png');
    const stdin = spawnSync(
      process.execPath,
      [cli.pathname.replace(/^\/(?=[A-Za-z]:)/, ''), '-', '--output', '-', '--format', 'json'],
      { input: source, encoding: 'utf8' },
    );
    assert.equal(stdin.status, 0, stdin.stderr);
    assert.deepEqual(JSON.parse(stdin.stdout), document);
    const bad = join(directory, 'bad.json');
    await writeFile(
      bad,
      JSON.stringify({
        version: 1,
        diagram: { name: 'Bad' },
        nodes: [{ id: 'A' }],
        edges: [{ from: 'A', to: 'missing' }],
      }),
    );
    await writeFile(svg, 'keep existing SVG');
    await assert.rejects(
      run(process.execPath, [cli.pathname.replace(/^\/(?=[A-Za-z]:)/, ''), bad, '--output', svg]),
    );
    assert.equal(await readFile(svg, 'utf8'), 'keep existing SVG');
    for (const args of [
      [input, '--output', input, '--format', 'svg'],
      [input, '--output', svg, '--format', 'png'],
      [input, '--unknown'],
    ])
      await assert.rejects(run(process.execPath, [cli.pathname.replace(/^\/(?=[A-Za-z]:)/, ''), ...args]));
  } finally {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith('flowchart-runtime-'));
    await rm(directory, { recursive: true, force: true });
  }
});
