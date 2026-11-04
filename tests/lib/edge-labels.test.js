import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { createDiagramModel, layoutDiagram, renderSvg } from '../../src/lib/index.js';
import { placeEdgeLabels } from '../../src/lib/layout/edge-labels.js';
import { TEXT_STYLE, connectionStyle } from '../../src/lib/styles.js';
import { fixture, freeze, checkLayout } from './helpers.js';

const intersects = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
const labeledEdge = (id, points, label = 'data') => ({ id, label, style: { ...connectionStyle(1), label: { ...TEXT_STYLE } }, sections: [{ points }] });

for (const value of ['', '  ', null, 1, 'a\tb', '\u0000', '\ud800']) test('connection label rejects ' + JSON.stringify(value), () => {
  const raw = fixture(); raw.connections[0].label = value;
  assert.throws(() => createDiagramModel(raw), error => error.path === 'connections[0].label');
});

test('connection label styles inherit per property and are independently owned', () => {
  const raw = fixture(); raw.connections[0].label = 'data';
  raw.diagram.style = { connection: { label: { color: '#abc', fontSize: 18, padding: 3 } } };
  raw.connections[0].style = { label: { color: '#123' } };
  const before = structuredClone(raw), model = createDiagramModel(freeze(raw));
  assert.deepEqual(model.connections[0].style.label, { ...TEXT_STYLE, color: '#112233', fontSize: 18, padding: 3 });
  model.connections[0].style.label.padding = 5;
  assert.deepEqual(raw, before);
  for (const style of [{ label: null }, { label: { fontSize: 0 } }, { label: { color: 'red' } }]) {
    const invalid = fixture(); invalid.connections[0].style = style;
    assert.throws(() => createDiagramModel(invalid));
  }
});

test('crossing/parallel routes avoid text, strokes and crossing points deterministically', () => {
  const input = { modules: [], groups: [], connections: [
    labeledEdge('a', [{x:0,y:100},{x:300,y:100}]),
    labeledEdge('b', [{x:150,y:0},{x:150,y:220}], 'ready'),
    labeledEdge('c', [{x:0,y:130},{x:300,y:130}], 'valid'),
  ] };
  const duplicate = structuredClone(input);
  assert.deepEqual(placeEdgeLabels(input), []);
  assert.deepEqual(placeEdgeLabels(duplicate), []);
  assert.deepEqual(input, duplicate);
  for (const edge of input.connections) {
    const bounds = edge.labelBounds;
    for (const other of input.connections) {
      if (edge !== other) assert.ok(!intersects(bounds, other.labelBounds));
      const [a,b] = other.sections[0].points;
      const stroke = { x:Math.min(a.x,b.x)-1,y:Math.min(a.y,b.y)-1,width:Math.abs(a.x-b.x)+2,height:Math.abs(a.y-b.y)+2 };
      assert.ok(!intersects(bounds, stroke), 'label masks a route');
    }
  }
});

test('blocked labels remain visible with a structured warning', () => {
  const edge = labeledEdge('blocked', [{x:10,y:50},{x:30,y:50}], 'long label');
  const warnings = placeEdgeLabels({ modules: [{x:-100,y:-100,width:300,height:300}], groups: [], connections:[edge] });
  assert.equal(warnings[0].code, 'EDGE_LABEL_OVERLAP');
  assert.equal(warnings[0].connectionId, 'blocked');
  assert.ok(edge.labelBounds && edge.labelPosition);
});

for (const direction of ['right', 'left']) test('ELK reserves text space; bounds, SVG and PNG agree ' + direction, async () => {
  const raw = fixture(); raw.layout = { direction }; raw.connections[0].label = 'data <&> \u8cc7\u6599';
  raw.connections[0].style = { label: { color:'#123456', backgroundColor:'#fff', padding:4, fontSize:20 } };
  const model = createDiagramModel(raw), before = structuredClone(model);
  const result = await layoutDiagram(freeze(model)); checkLayout(model, result);
  assert.deepEqual(model, before); assert.equal(result.warnings, undefined);
  const edge = result.connections[0], bounds = edge.labelBounds;
  assert.ok(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= result.width && bounds.y + bounds.height <= result.height);
  for (const node of result.modules) assert.ok(!intersects(node,bounds));
  const svg = renderSvg(result);
  assert.ok(svg.includes('data &lt;&amp;&gt; \u8cc7\u6599'));
  assert.ok(svg.includes('data-role="connection-label"'));
  assert.ok(svg.includes('fill="#123456"'));
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  const metadata = await sharp(png).metadata();
  assert.equal(metadata.width, Math.round(result.width + 40));
});

test('nested group labels and outer feedback use final absolute routes', async () => {
  const raw = JSON.parse(await readFile(new URL('../../examples/connection-labels.json', import.meta.url), 'utf8'));
  const result = await layoutDiagram(createDiagramModel(raw));
  assert.equal(result.warnings, undefined);
  assert.ok(result.connections.some(edge => edge.routingInfo?.method === 'outer-aabb'));
  for (const edge of result.connections) {
    for (const node of result.modules) assert.ok(!intersects(edge.labelBounds, node));
    for (const group of result.groups) assert.ok(!intersects(edge.labelBounds, group.labelBounds));
    assert.ok(edge.sections.some(section => section.points.slice(1).some((b,i) => {
      const a = section.points[i], p = edge.labelPosition;
      return a.y === b.y ? p.x >= Math.min(a.x,b.x) && p.x <= Math.max(a.x,b.x) && Math.abs(p.y-a.y) < 60
        : p.y >= Math.min(a.y,b.y) && p.y <= Math.max(a.y,b.y) && Math.abs(p.x-a.x) < 80;
    })), 'label detached from final route');
  }
});

test('once layout retains connection labels on complex feedback routes', async () => {
  const raw = JSON.parse(await readFile(new URL('../../examples/placement-feedback.json', import.meta.url), 'utf8'));
  raw.connections.forEach((edge,i) => edge.label = ['data','ready','valid'][i%3]);
  const result = await layoutDiagram(createDiagramModel(raw));
  for (const edge of result.connections) {
    assert.ok(edge.labelBounds && edge.labelPosition);
    assert.ok(renderSvg(result).includes('data-role="connection-label"'));
  }
});
