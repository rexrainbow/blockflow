import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv from 'ajv/dist/2020.js';
import { DOMParser } from '@xmldom/xmldom';
import sharp from 'sharp';
import { createDiagramModel, layoutDiagram, renderSvg } from '../../src/lib/index.js';
import { fixture, freeze } from './helpers.js';

const validate = new Ajv({ strict: true, allErrors: true }).compile(
  JSON.parse(await readFile(new URL('../../schema/blockflow.schema.json', import.meta.url), 'utf8')),
);
function sample() {
  const raw = fixture();
  raw.modules.push({ id: 'c', ports: [{ id: 'i', direction: 'input' }] });
  raw.connections[0].to.push('c.i');
  raw.connections[0].label = 'Shared signal\n32 bits';
  raw.diagram.style = {
    connection: {
      label: {
        backgroundColor: '#FFF9E6',
        padding: 4,
        borderColor: '#B38900',
        borderWidth: 0.8,
        borderOpacity: 0.7,
        borderRadius: 4,
        repeatAtEnd: 'always',
      },
    },
  };
  return raw;
}
const rects = (svg) =>
  [...new DOMParser().parseFromString(svg, 'image/svg+xml').getElementsByTagName('rect')].filter(
    (r) => r.getAttribute('data-role') === 'label-background',
  );

test('Net frames inherit per property, render once at the shared source and at each callout, and export PNG', async () => {
  const raw = sample(),
    before = structuredClone(raw);
  raw.connections[0].style = { label: { borderOpacity: 0.5 } };
  const snapshot = structuredClone(raw),
    model = createDiagramModel(freeze(raw));
  assert.equal(validate(raw), true, JSON.stringify(validate.errors));
  assert.equal(model.connections[0].style.label.borderColor, '#b38900');
  assert.equal(model.connections[0].style.label.borderOpacity, 0.5);
  const layout = await layoutDiagram(model),
    svg = renderSvg(layout),
    frames = rects(svg);
  assert.equal(frames.length, 3);
  for (const frame of frames) {
    assert.equal(frame.getAttribute('fill'), '#fff9e6');
    assert.equal(frame.getAttribute('stroke'), '#b38900');
    assert.equal(frame.getAttribute('stroke-opacity'), '0.5');
    assert.equal(frame.getAttribute('stroke-width'), '0.8');
    assert.equal(frame.getAttribute('rx'), '4');
  }
  assert.deepEqual(raw, snapshot);
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  assert.equal((await sharp(png).metadata()).format, 'png');
  assert.equal(before.connections[0].style, undefined);
});

test('Transparent fills can have frames; zero width/opacity and hidden labels remove frame ink', async () => {
  const raw = sample(),
    style = raw.diagram.style.connection.label;
  style.backgroundColor = 'transparent';
  const visible = await layoutDiagram(createDiagramModel(raw));
  assert.equal(rects(renderSvg(visible)).length, 3);
  for (const frame of rects(renderSvg(visible))) assert.equal(frame.getAttribute('fill-opacity'), '0');
  for (const partial of [
    { borderWidth: 0 },
    { borderOpacity: 0 },
    { borderColor: 'transparent' },
    { hidden: true },
  ]) {
    const input = structuredClone(raw);
    Object.assign(input.diagram.style.connection.label, partial);
    assert.equal(rects(renderSvg(await layoutDiagram(createDiagramModel(input)))).length, 0);
  }
});

test('Frame strokes and radii stay within reserved label bounds without changing layout', async () => {
  const raw = sample(),
    original = await layoutDiagram(createDiagramModel(raw));
  Object.assign(raw.diagram.style.connection.label, { borderWidth: 1e6, borderRadius: 1e6 });
  const layout = await layoutDiagram(createDiagramModel(raw));
  assert.deepEqual(layout.modules, original.modules);
  assert.deepEqual(
    layout.connections.map((e) => [e.sections, e.labelInstances]),
    original.connections.map((e) => [e.sections, e.labelInstances]),
  );
  const bounds = new Map();
  for (const edge of layout.connections)
    for (const label of edge.labelInstances) {
      bounds.set(`${label.bounds.x}:${label.bounds.y}`, label.bounds);
    }
  for (const rect of rects(renderSvg(layout))) {
    const n = (key) => Number(rect.getAttribute(key));
    const stroke = n('stroke-width'),
      x = n('x') - stroke / 2,
      y = n('y') - stroke / 2;
    const b = [...bounds.values()].find((b) => Math.abs(b.x - x) < 1e-6 && Math.abs(b.y - y) < 1e-6);
    assert.ok(b);
    assert.ok(n('width') + stroke <= b.width + 1e-6);
    assert.ok(n('height') + stroke <= b.height + 1e-6);
    assert.ok(n('rx') <= Math.min(n('width'), n('height')) / 2);
  }
});

test('Frame schema and runtime reject malformed values; other text styles retain their existing contract', () => {
  for (const partial of [
    { borderColor: 'gold' },
    { borderWidth: -1 },
    { borderRadius: -1 },
    { borderOpacity: 1.1 },
    { borderWidth: null },
    { borderRadius: '4' },
  ]) {
    const raw = sample();
    Object.assign(raw.diagram.style.connection.label, partial);
    assert.equal(validate(raw), false);
    assert.throws(() => createDiagramModel(raw));
  }
  const raw = sample();
  raw.modules[0].ports[0].style = { borderColor: '#B38900' };
  assert.equal(validate(raw), false);
  assert.throws(() => createDiagramModel(raw), /Unsupported style property/);
});
