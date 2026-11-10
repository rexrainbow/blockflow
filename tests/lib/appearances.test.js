import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import sharp from 'sharp';
import { createDiagramModel, layoutDiagram, renderSvg } from '../../src/lib/index.js';
import { moduleGeometry } from '../../src/lib/blockchart/geometry.js';
import { copyLayout } from '../../src/lib/blockchart/view/layout.js';
import { connectionArrow } from '../../src/lib/blockchart/layout/arrows.js';
import { fixture, checkLayout, freeze } from './helpers.js';
import { convertToBoundaryGroup } from '../../src/editor/state/commands.js';
import { routeOuterFeedback } from '../../src/lib/blockchart/layout/outer-feedback.js';

const load = async name => JSON.parse(await readFile(new URL(`../../examples/${name}.json`, import.meta.url), 'utf8'));
const schema = JSON.parse(await readFile(new URL('../../schema/blockchart.schema.json', import.meta.url), 'utf8'));
const validate = new Ajv2020({ strict: true, allErrors: true }).compile(schema);

test('appearance parameters, visibility, arrow and feedback side reject malformed JSON consistently', () => {
  const changes = [
    d => d.modules[0].appearance = null,
    d => d.modules[0].appearance = { type: 'polygon' },
    d => d.modules[0].appearance = { type: 'rectangle', layers: 2 },
    ...[0, 4, 1.5, '2', null].map(layers => d => d.modules[0].appearance = { type: 'stacked', layers }),
    ...[0, 0.19, 1.1, '0.6', null].map(rightHeightRatio => d => d.modules[0].appearance = { type: 'trapezoid', rightHeightRatio }),
    d => d.modules[0].style = { portLabel: { hidden: 'true' } },
    d => d.connections[0].style = { endArrow: 'diamond' },
    d => d.layout = { feedbackSide: 'left' },
  ];
  for (const change of changes) {
    const raw = fixture(); change(raw);
    assert.equal(validate(raw), false, JSON.stringify(raw));
    assert.throws(() => createDiagramModel(raw), { name: 'DiagramValidationError' });
  }
  for (const type of ['rectangle', 'stacked', 'trapezoid']) {
    const raw = fixture(); raw.modules[0].appearance = { type };
    assert.equal(validate(raw), true, JSON.stringify(validate.errors));
    const before = structuredClone(raw), model = createDiagramModel(raw);
    assert.deepEqual(raw, before);
    assert.equal(model.modules[0].appearance.type, type);
    if (type === 'stacked') assert.equal(model.modules[0].appearance.layers, 2);
    if (type === 'trapezoid') assert.equal(model.modules[0].appearance.rightHeightRatio, 0.6);
  }
});

for (const direction of ['right']) test(`appearance geometry keeps endpoints, names and complete footprints (${direction})`, async () => {
  const raw = await load('block-appearances'); raw.layout = { direction };
  const model = freeze(createDiagramModel(raw)), layout = await layoutDiagram(model);
  checkLayout(model, layout);
  assert.deepEqual(copyLayout(layout), layout);
  const mux = layout.modules.find(m => m.id === 'Mux'), bank = layout.modules.find(m => m.id === 'Bank');
  assert.equal(mux.body.shapes[0].kind, 'polygon');
  const [leftTop, rightTop, rightBottom, leftBottom] = mux.body.shapes[0].points;
  assert.ok(rightTop.y > leftTop.y && rightBottom.y < leftBottom.y);
  assert.ok(mux.ports.find(p => p.id === 'out').y > mux.y + rightTop.y);
  assert.ok(mux.ports.find(p => p.id === 'out').y < mux.y + rightBottom.y);
  for (const port of mux.ports) {
    assert.ok(port.labelBounds.x >= mux.x);
    assert.ok(port.labelBounds.x + port.labelBounds.width <= mux.x + mux.width);
  }
  assert.equal(bank.body.shapes.length, 3);
  assert.ok(bank.labelPosition.x < bank.x + bank.width / 2);
  assert.equal(bank.collapsed, undefined);
  for (const edge of layout.connections) {
    assert.deepEqual(edge.arrow.points[0], edge.sections.at(-1).points.at(-1));
    for (const point of edge.arrow.points) {
      assert.ok(point.x >= 0 && point.x <= layout.width);
      assert.ok(point.y >= 0 && point.y <= layout.height);
    }
  }
  const svg = renderSvg(layout);
  assert.equal((svg.match(/data-role="connection-arrow"/g) ?? []).length, 2);
  assert.ok(svg.includes('data-appearance="trapezoid"'));
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  assert.ok(png.length > 1000);
  const unsafe = structuredClone(layout); unsafe.modules[1].body.shapes[0].points[0].x = NaN;
  assert.throws(() => copyLayout(unsafe), /body x/);
  const badArrow = structuredClone(layout); badArrow.connections[0].arrow.points.pop();
  assert.throws(() => copyLayout(badArrow), /arrow/);
});

test('port visibility removes text space, preserves ports and permits local overrides', async () => {
  const raw = fixture();
  raw.modules[0].ports[0].label = 'a very long input label '.repeat(6);
  raw.modules[0].style = { portLabel: { padding: 20, fontSize: 50 } };
  const visible = moduleGeometry(createDiagramModel(raw).modules[0]);
  raw.diagram.style = { module: { portLabel: { hidden: true } } };
  const hiddenModel = createDiagramModel(raw), hidden = moduleGeometry(hiddenModel.modules[0]);
  assert.ok(hidden.width < visible.width && hidden.height < visible.height);
  const layout = await layoutDiagram(hiddenModel);
  assert.equal(layout.modules[0].ports.length, 2);
  assert.ok(layout.modules.every(m => m.ports.every(p => p.style.hidden === true && p.labelBounds.width === 0)));
  assert.ok(!renderSvg(layout).includes('a very long input'));
  raw.modules[0].style.portLabel.hidden = false;
  const overridden = createDiagramModel(raw);
  assert.equal(overridden.modules[0].ports[0].style.hidden, false);
  assert.equal(overridden.modules[1].ports[0].style.hidden, true);
});

for (const side of ['auto', 'top', 'bottom']) test(`signal schematic routes exterior feedback on ${side} with arrows and hidden ports`, async () => {
  const raw = await load('signal-schematic'); raw.layout.feedbackSide = side;
  assert.equal(validate(raw), true, JSON.stringify(validate.errors));
  const model = createDiagramModel(raw), layout = await layoutDiagram(model);
  checkLayout(model, layout);
  const feedback = layout.connections.at(-1);
  assert.equal(feedback.routingInfo.method, 'outer-aabb');
  if (side !== 'auto') assert.equal(feedback.routingInfo.side, side);
  const y = feedback.routingInfo.waypoints[0].y;
  if (feedback.routingInfo.side === 'top') assert.ok(layout.modules.every(m => y < m.y));
  else assert.ok(layout.modules.every(m => y > m.y + m.height));
  assert.equal(layout.connections.filter(e => e.arrow).length, 4);
  assert.equal(layout.modules.flatMap(m => m.ports).filter(p => p.style.hidden === true).length, 8);
});

test('arrows use last nonzero segment and cap size to the available length', () => {
  const edge = { style: { endArrow: 'triangle', strokeWidth: 10 }, sections: [{ points: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 0 }] }] };
  const arrow = connectionArrow(edge);
  assert.deepEqual(arrow.points, [{ x: 2, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]);
  edge.style.endArrow = 'none'; assert.equal(connectionArrow(edge), undefined);
  edge.style.endArrow = 'triangle'; edge.sections[0].points = [{ x: 2, y: 0 }, { x: 2, y: 0 }];
  assert.equal(connectionArrow(edge), undefined);
});

test('dense trapezoid port text remains inside both sloping edges', async () => {
  const raw = fixture();
  raw.modules[0].appearance = { type: 'trapezoid', rightHeightRatio: 0.2 };
  raw.modules[0].ports.push(...Array.from({ length: 35 }, (_, i) => ({ id: 'long_' + i, label: 'Long input name '.repeat(4), direction: 'input' })));
  const layout = await layoutDiagram(createDiagramModel(raw)), block = layout.modules[0];
  const slope = (block.height * 0.4) / block.width;
  for (const port of block.ports) {
    const bounds = port.labelBounds;
    const x = bounds.x + bounds.width - block.x;
    assert.ok(bounds.y - block.y >= slope * x, port.id + ' above body');
    assert.ok(bounds.y + bounds.height - block.y <= block.height - slope * x, port.id + ' below body');
  }
});

test('shape conversion rejects atomically until Rectangle is selected and retains port visibility', () => {
  const raw = fixture(); raw.modules[0].appearance = { type: 'stacked' };
  const before = structuredClone(raw);
  assert.throws(() => convertToBoundaryGroup(raw, 'a'), /Rectangle/);
  assert.deepEqual(raw, before);
  raw.modules[0].appearance = { type: 'rectangle' };
  raw.diagram.style = { module: { portLabel: { hidden: true } } };
  convertToBoundaryGroup(raw, 'a');
  assert.equal(raw.groups[0].appearance, undefined);
  assert.equal(createDiagramModel(raw).groups[0].ports[0].style.hidden, true);
  assert.equal(createDiagramModel(raw).groups[0].ports[0].style.hidden, true);
});

test('expanded and collapsed boundary ports inherit visibility with local override', async () => {
  const raw = await load('boundary-groups');
  raw.diagram.style = { module: { portLabel: { hidden: true } } };
  const model = createDiagramModel(raw);
  assert.ok(model.groups.every(g => g.ports.every(p => p.style.hidden)));
  const layout = await layoutDiagram(model);
  assert.ok(layout.groups.flatMap(g => g.ports ?? []).every(p => p.style.hidden === true));
  const boundary = raw.groups.find(g => g.type === 'boundary' || g.portMode === 'boundary');
  boundary.style = { portLabel: { hidden: false } }; boundary.collapsed = true;
  const collapsed = await layoutDiagram(createDiagramModel(raw));
  assert.ok(collapsed.groups.find(g => g.id === boundary.id).ports.every(p => p.style.hidden === false));
});

test('requested blocked exterior side preserves ELK route and does not choose the other side', () => {
  const modules = [
    { id: 's', x: 0, y: 0, width: 100, height: 100, ports: [{ id: 'o', x: 100, y: 50 }] },
    { id: 'blocker', x: 110, y: 0, width: 80, height: 100, ports: [] },
    { id: 't', x: 0, y: 200, width: 100, height: 100, ports: [{ id: 'i', x: 0, y: 250 }] },
  ];
  const sections = [{ points: [{ x: 100, y: 50 }, { x: 105, y: 50 }, { x: 105, y: 110 }, { x: -20, y: 110 }, { x: -20, y: 250 }, { x: 0, y: 250 }] }];
  for (const side of ['top', 'bottom']) {
    const edge = { id: 'back', sections: structuredClone(sections) };
    routeOuterFeedback({ modules, connections: [edge] }, { layout: { feedbackSide: side }, connections: [{ id: 'back', source: { moduleId: 's', portId: 'o' }, target: { moduleId: 't', portId: 'i' } }] });
    assert.equal(edge.routingInfo.reason, 'outer-access-blocked');
    assert.deepEqual(edge.sections, sections);
  }
});
