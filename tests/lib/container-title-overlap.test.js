import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { DOMParser } from '@xmldom/xmldom';
import { createDiagramModel, layoutDiagram, renderSvg } from '../../src/lib/index.js';
import { textBounds } from '../../src/lib/blockchart/geometry.js';
import { resolveGroupStyle, connectionStyle } from '../../src/lib/blockchart/styles.js';

const parse = (svg) => new DOMParser().parseFromString(svg, 'image/svg+xml');
const byRole = (doc, role) =>
  Array.from(doc.getElementsByTagName('*')).filter((n) => n.getAttribute('data-role') === role);
function scene(fillColor, fillOpacity = 1, labelBackground = '#00000000') {
  const parent = {
    id: 'Parent',
    members: ['Child<&'],
    portMode: 'direct',
    x: 5,
    y: 5,
    width: 220,
    height: 130,
    label: 'Parent',
    style: resolveGroupStyle({ fillColor: '#28486880', fillOpacity: 0.7, label: { hidden: true } }),
  };
  const child = {
    id: 'Child<&',
    members: [],
    portMode: 'direct',
    x: 20,
    y: 20,
    width: 180,
    height: 100,
    label: 'Header',
    labelPosition: { x: 30, y: 40, anchor: 'start' },
    style: resolveGroupStyle({
      fillColor,
      fillOpacity,
      label: { padding: 4, backgroundColor: labelBackground },
    }),
  };
  child.labelBounds = textBounds(child.label, child.labelPosition, child.style.label);
  return {
    width: 240,
    height: 150,
    modules: [],
    groups: [parent, child],
    connections: [
      {
        id: 'Wire',
        width: null,
        style: { ...connectionStyle(null), strokeWidth: 2, strokeColor: '#1255cc' },
        sections: [
          {
            points: [
              { x: 29, y: 15 },
              { x: 29, y: 120 },
            ],
          },
        ],
        arrow: {
          points: [
            { x: 29, y: 40 },
            { x: 25, y: 32 },
            { x: 33, y: 32 },
          ],
        },
      },
    ],
  };
}
async function raster(layout) {
  return sharp(Buffer.from(renderSvg(layout)))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
}
const pixel = (image, x, y) => {
  const at = ((y + 20) * image.info.width + x + 20) * image.info.channels;
  return [...image.data.subarray(at, at + 4)];
};

for (const [fill, opacity, background] of [
  ['#fff4d6', 1, '#00000000'],
  ['#00000000', 1, '#00000000'],
  ['#00ff0040', 0.6, '#00000000'],
  ['#00ff0040', 0.6, '#ff000080'],
])
  test(`Container titles retain overlapping wires: ${fill}/${opacity}, title ${background}`, async () => {
    const layout = scene(fill, opacity, background),
      before = structuredClone(layout);
    const control = structuredClone(layout);
    control.connections = [];
    const [actual, backdrop] = await Promise.all([raster(layout), raster(control)]);
    // x=29 is inside conservative title padding, clear of glyph ink.
    // The crossing wire/arrow must remain visible, including over alpha backgrounds.
    assert.notDeepEqual(pixel(actual, 29, 40), pixel(backdrop, 29, 40));
    assert.notDeepEqual(
      pixel(actual, 29, 70),
      pixel(backdrop, 29, 70),
      'wire remains visible beyond the title',
    );
    assert.deepEqual(layout, before);
  });

test('Container headings never mask wire paths/arrows or duplicate frame identities', () => {
  const layout = scene('#ffffff'),
    before = structuredClone(layout);
  const doc = parse(renderSvg(layout, { idPrefix: 'A<&' }));
  assert.equal(doc.getElementsByTagName('mask').length, 0);
  const wires = byRole(doc, 'connection-layer')[0];
  assert.equal(wires.hasAttribute('mask'), false);
  assert.equal(wires.getElementsByTagName('path')[0].getAttribute('d'), 'M 29 15 L 29 120');
  assert.equal(wires.getElementsByTagName('polygon').length, 1);
  assert.equal(wires.getElementsByTagName('text').length, 0);
  assert.equal(byRole(doc, 'group').length, 2);
  assert.deepEqual(layout, before);
});

test('a wire inside the estimated right title extent has no phantom gap', async () => {
  const layout = scene('#fff4d6');
  const group = layout.groups[1];
  group.label = 'Interrupts';
  group.labelBounds = textBounds(group.label, group.labelPosition, group.style.label);
  const x = group.labelBounds.x + group.labelBounds.width - 3;
  layout.connections[0].sections[0].points = [
    { x, y: 15 },
    { x, y: 120 },
  ];
  delete layout.connections[0].arrow;
  const image = await raster(layout);
  assert.deepEqual(
    pixel(image, x, 40),
    pixel(image, x, 70),
    'wire ink continues across the excess layout estimate',
  );
});

test(`incoming wires may cross a Container heading without detours:`, async () => {
  const raw = {
    version: 1,
    diagram: { name: 'Straight heading crossing' },
    layout: { direction: 'down', portAdjustment: 'fixed' },
    modules: [{ id: 'Core', ports: [{ id: 'in', direction: 'input' }] }],
    groups: [{ id: 'Frame', label: 'A deliberately long descriptive heading', members: ['Core'] }],
    terminals: [{ id: 'Input', direction: 'input' }],
    connections: [{ from: { terminal: 'Input' }, to: ['Core.in'] }],
  };
  const model = createDiagramModel(raw),
    before = structuredClone(model),
    layout = await layoutDiagram(model),
    edge = layout.connections[0],
    points = edge.sections.flatMap((s) => s.points),
    box = layout.groups[0].labelBounds;
  assert.ok(
    points.every((p) => Math.abs(p.x - points[0].x) < 1e-6),
    'no sideways detour solely for a heading',
  );
  assert.ok(points[0].x > box.x && points[0].x < box.x + box.width);
  assert.ok(points[0].y < box.y && points.at(-1).y > box.y + box.height);
  assert.equal(layout.warnings, undefined);
  assert.ok(!renderSvg(layout).includes('container-title-mask'));
  assert.deepEqual(model, before);
});
