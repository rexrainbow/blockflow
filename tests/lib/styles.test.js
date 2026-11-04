import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DOMParser } from '@xmldom/xmldom';
import sharp from 'sharp';
import { createDiagramModel, DiagramValidationError, layoutDiagram, renderSvg } from '../../src/lib/index.js';
import { exportPng } from '../../src/lib/node.js';
import { fixture, freeze } from './helpers.js';

test('style inheritance is per property, diagram then module then port; owned copies', () => {
  const input = fixture();
  input.diagram.style = {
    connection: { strokeColor: '#ABC', opacity: 0.6 },
    module: {
      fillColor: '#1234', label: { color: '#112233', fontSize: 18 },
      portLabel: { color: '#444', padding: 2 },
      inputPortLabel: { color: '#00f', fontSize: 16 },
      outputPortLabel: { backgroundColor: '#eee' },
    },
  };
  input.modules[0].style = {
    borderWidth: 4, label: { backgroundColor: '#fff' },
    portLabel: { color: '#080' }, inputPortLabel: { padding: 5 },
  };
  input.modules[0].ports[0].style = { opacity: 0.5 };
  input.connections[0].style = { lineStyle: 'dotted' };
  const before = structuredClone(input);
  const model = createDiagramModel(freeze(input));
  const a = model.modules[0], b = model.modules[1];
  assert.equal(a.style.fillColor, '#11223344');
  assert.equal(a.style.label.fontSize, 18);
  assert.equal(a.style.label.backgroundColor, '#ffffff');
  assert.equal(a.ports[0].style.color, '#008800');
  assert.equal(a.ports[0].style.fontSize, 16);
  assert.equal(a.ports[0].style.padding, 5);
  assert.equal(a.ports[0].style.opacity, 0.5);
  assert.equal(a.ports[1].style.backgroundColor, '#eeeeee');
  assert.equal(b.ports[0].style.color, '#0000ff');
  assert.equal(b.ports[0].style.padding, 2);
  assert.equal(model.connections[0].style.strokeColor, '#aabbcc');
  assert.equal(model.connections[0].style.opacity, 0.6);
  assert.equal(model.connections[0].style.lineStyle, 'dotted');
  a.style.label.color = '#ffffff';
  a.ports[0].style.padding = 99;
  assert.equal(b.style.label.color, '#112233');
  assert.equal(b.ports[0].style.padding, 2);
  assert.deepEqual(input, before);
});

test('bus thickness defaults and explicit diagram/connection strokeWidth are independent of bit width', () => {
  const input = fixture();
  input.modules[0].ports[1].width = input.modules[1].ports[0].width = 8;
  assert.equal(createDiagramModel(input).connections[0].style.strokeWidth, 2.5);
  input.diagram.style = { connection: { strokeWidth: 4 } };
  assert.equal(createDiagramModel(input).connections[0].style.strokeWidth, 4);
  input.connections[0].style = { strokeWidth: 2 };
  const connection = createDiagramModel(input).connections[0];
  assert.equal(connection.style.strokeWidth, 2);
  assert.equal(connection.width, 8);
});

const invalid = [
  ['null diagram', v => v.diagram.style = null, 'diagram.style'],
  ['array module', v => v.modules[0].style = [], 'modules[0].style'],
  ['null text', v => v.modules[0].style = { label: null }, 'modules[0].style.label'],
  ['unknown style', v => v.connections[0].style = { arrowHead: 'normal' }, 'connections[0].style.arrowHead'],
  ['raw CSS', v => v.modules[0].ports[0].style = { css: 'color:red' }, 'modules[0].ports[0].style.css'],
  ['font family', v => v.modules[0].style = { label: { fontFamily: 'Arial' } }, 'modules[0].style.label.fontFamily'],
  ['bad hex', v => v.connections[0].style = { strokeColor: '#12' }, 'connections[0].style.strokeColor'],
  ['color trailing newline', v => v.connections[0].style = { strokeColor: '#abc\n' }, 'connections[0].style.strokeColor'],
  ['CSS color', v => v.connections[0].style = { strokeColor: 'var(--x)' }, 'connections[0].style.strokeColor'],
  ['color injection', v => v.modules[0].style = { fillColor: '\"/><script/>' }, 'modules[0].style.fillColor'],
  ['null color', v => v.modules[0].style = { borderColor: null }, 'modules[0].style.borderColor'],
  ['zero width', v => v.connections[0].style = { strokeWidth: 0 }, 'connections[0].style.strokeWidth'],
  ['string width', v => v.modules[0].style = { borderWidth: '2' }, 'modules[0].style.borderWidth'],
  ['infinite size', v => v.modules[0].style = { label: { fontSize: Infinity } }, 'modules[0].style.label.fontSize'],
  ['negative padding', v => v.modules[0].ports[0].style = { padding: -1 }, 'modules[0].ports[0].style.padding'],
  ['opacity above one', v => v.modules[0].style = { fillOpacity: 1.1 }, 'modules[0].style.fillOpacity'],
  ['negative opacity', v => v.connections[0].style = { opacity: -0.1 }, 'connections[0].style.opacity'],
  ['null opacity', v => v.modules[0].ports[0].style = { opacity: null }, 'modules[0].ports[0].style.opacity'],
  ['bad line style', v => v.modules[0].style = { borderStyle: 'double' }, 'modules[0].style.borderStyle'],
];
for (const [name, mutate, path] of invalid) test(`style validation: ${name}`, () => {
  const input = fixture(); mutate(input);
  assert.throws(() => createDiagramModel(input), e => e instanceof DiagramValidationError && e.path === path);
});

function inside(bounds, node) {
  assert.ok(bounds.x >= node.x - 1e-6);
  assert.ok(bounds.y >= node.y - 1e-6);
  assert.ok(bounds.x + bounds.width <= node.x + node.width + 1e-6);
  assert.ok(bounds.y + bounds.height <= node.y + node.height + 1e-6);
}

test('font size, per-row padding and thick borders reserve space before layout; no mutation', async () => {
  const input = fixture();
  input.modules[0].label = 'Wide block title';
  input.modules[0].style = { borderWidth: 48, label: { fontSize: 32, padding: 8, backgroundColor: '#ff0' } };
  input.modules[0].ports.push({ id: 'second', direction: 'input', style: { fontSize: 36, padding: 12 } });
  input.modules[0].ports[0].style = { fontSize: 28, padding: 9 };
  input.modules[0].ports[1].style = { fontSize: 18, padding: 6 };
  const model = createDiagramModel(input);
  const before = structuredClone(model);
  const layout = await layoutDiagram(freeze(model));
  assert.deepEqual(model, before);
  const node = layout.modules[0];
  assert.ok(node.width > 400 && node.height > 200);
  inside(node.labelBounds, node);
  for (const port of node.ports) {
    inside(port.labelBounds, node);
    assert.ok(port.labelBounds.y >= node.labelBounds.y + node.labelBounds.height);
    assert.equal(port.x, port.direction === 'input' ? node.x : node.x + node.width);
  }
  const inputs = node.ports.filter(p => p.direction === 'input');
  assert.ok(inputs[1].labelBounds.y >= inputs[0].labelBounds.y + inputs[0].labelBounds.height);
  const left = node.ports.find(p => p.direction === 'input').labelBounds;
  const right = node.ports.find(p => p.direction === 'output').labelBounds;
  assert.ok(left.x + left.width < right.x);
  node.style.label.padding = 999;
  assert.equal(model.modules[0].style.label.padding, 8);
});

test('SVG resolves colors, alpha, text backgrounds and dash patterns without CSS or foreignObject', async () => {
  const input = fixture();
  input.modules[0].style = {
    borderColor: '#abcd', borderStyle: 'dotted', borderWidth: 4, borderOpacity: 0.5,
    fillColor: 'transparent', label: { color: '#123', fontSize: 24, backgroundColor: '#def', padding: 3, opacity: 0.4, backgroundOpacity: 0.7 },
  };
  input.connections[0].style = { strokeColor: '#ff000080', strokeWidth: 3, lineStyle: 'dashed', opacity: 0.5 };
  const layout = await layoutDiagram(createDiagramModel(input));
  const before = structuredClone(layout);
  const svg = renderSvg(freeze(layout));
  assert.equal(renderSvg(layout), svg);
  assert.deepEqual(layout, before);
  const errors = [];
  const doc = new DOMParser({ onError: (level, message) => errors.push(message) }).parseFromString(svg, 'image/svg+xml');
  assert.deepEqual(errors, []);
  const path = doc.getElementsByTagName('path')[0];
  assert.equal(path.getAttribute('stroke'), '#ff0000');
  assert.equal(Number(path.getAttribute('stroke-opacity')), 128 / 255 * 0.5);
  assert.equal(path.getAttribute('stroke-dasharray'), '12 6');
  const rects = Array.from(doc.getElementsByTagName('rect'));
  const block = rects[1];
  assert.equal(block.getAttribute('stroke-dasharray'), '0 12');
  assert.equal(block.getAttribute('stroke-linecap'), 'round');
  assert.equal(block.getAttribute('fill-opacity'), '0');
  assert.equal(Number(block.getAttribute('x')) - 2, layout.modules[0].x);
  const backgrounds = rects.filter(r => r.getAttribute('data-role') === 'label-background');
  assert.equal(backgrounds.length, 1);
  assert.equal(backgrounds[0].getAttribute('fill'), '#ddeeff');
  assert.equal(backgrounds[0].getAttribute('fill-opacity'), '0.7');
  const title = doc.getElementsByTagName('text')[0];
  assert.equal(title.getAttribute('font-size'), '24');
  assert.equal(title.getAttribute('fill'), '#112233');
  assert.equal(title.getAttribute('fill-opacity'), '0.4');
  assert.equal(doc.getElementsByTagName('foreignObject').length, 0);
  assert.equal(doc.getElementsByTagName('style').length, 0);
});

test('PNG preserves solid/dashed/dotted patterns, colors and opacity from SVG', async t => {
  const layout = { width: 120, height: 80, modules: [], connections: [
    { width: 1, style: { strokeColor: '#ff0000', strokeWidth: 4 }, sections: [{ points: [{ x: 10, y: 20 }, { x: 110, y: 20 }] }] },
    { width: 1, style: { strokeColor: '#008000', strokeWidth: 4, lineStyle: 'dashed' }, sections: [{ points: [{ x: 10, y: 40 }, { x: 110, y: 40 }] }] },
    { width: 1, style: { strokeColor: '#0000ff', strokeWidth: 4, lineStyle: 'dotted', opacity: 0.5 }, sections: [{ points: [{ x: 10, y: 60 }, { x: 110, y: 60 }] }] },
  ] };
  const dir = await mkdtemp(join(tmpdir(), 'rtl-style-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'styles.png');
  await exportPng(renderSvg(layout), path);
  const { data, info } = await sharp(path).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixel = (x, y) => [...data.subarray(((y + 20) * info.width + x + 20) * 3, ((y + 20) * info.width + x + 20) * 3 + 3)];
  assert.deepEqual(pixel(50, 20), [255, 0, 0]);
  assert.deepEqual(pixel(12, 40), [0, 128, 0]);
  assert.deepEqual(pixel(29, 40), [255, 255, 255]);
  const dot = pixel(22, 60);
  assert.ok(dot[0] >= 126 && dot[0] <= 129 && dot[1] === dot[0] && dot[2] === 255);
  assert.deepEqual(pixel(16, 60), [255, 255, 255]);
});

test('very thick line is fully inside output bounds and reserves more routing space', async () => {
  const input = fixture();
  const baseline = await layoutDiagram(createDiagramModel(input));
  input.connections[0].style = { strokeWidth: 64 };
  const result = await layoutDiagram(createDiagramModel(input));
  assert.ok(result.modules[1].x - result.modules[0].x > baseline.modules[1].x - baseline.modules[0].x);
  for (const section of result.connections[0].sections) for (const point of section.points) {
    assert.ok(point.x >= 32 && point.y >= 32);
    assert.ok(point.x + 32 <= result.width && point.y + 32 <= result.height);
  }
});

test('JSON to PNG preserves inward border, fill alpha, text colors and padded label backgrounds', async t => {
  const input = fixture();
  input.modules = [input.modules[0]];
  input.connections = [];
  input.modules[0].style = {
    borderColor: '#112233', borderWidth: 6, fillColor: '#33669980',
    label: { color: '#0000ff', fontSize: 24, padding: 8, backgroundColor: '#ffff00', backgroundOpacity: 0.5 },
    portLabel: { color: '#ff0000', fontSize: 18, padding: 4, backgroundColor: '#00ff00' },
  };
  const layout = await layoutDiagram(createDiagramModel(input));
  const node = layout.modules[0];
  const dir = await mkdtemp(join(tmpdir(), 'rtl-style-paint-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'styles.png');
  await exportPng(renderSvg(layout), path);
  const { data, info } = await sharp(path).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixel = (x, y) => {
    const offset = (Math.floor(y + 20) * info.width + Math.floor(x + 20)) * 3;
    return [...data.subarray(offset, offset + 3)];
  };
  const nearColor = (actual, expected) => actual.forEach((n, i) => assert.ok(Math.abs(n - expected[i]) <= 2, `${actual} != ${expected}`));
  assert.deepEqual(pixel(node.x + 2, node.y + node.height - 15), [17, 34, 51]);
  nearColor(pixel(node.x + node.width / 2, node.y + node.height - 10), [153, 178, 204]);
  nearColor(pixel(node.labelBounds.x + 3, node.labelBounds.y + 3), [204, 217, 102]);
  const port = node.ports[0];
  assert.deepEqual(pixel(port.labelBounds.x + 1, port.labelBounds.y + 1), [0, 255, 0]);
  const hasColor = rgb => {
    for (let i = 0; i < data.length; i += 3) if (rgb.every((n, j) => data[i + j] === n)) return true;
    return false;
  };
  assert.ok(hasColor([0, 0, 255]), 'title foreground missing');
  assert.ok(hasColor([255, 0, 0]), 'port foreground missing');
});

test('once layout and outer feedback preserve resolved styles and label bounds', async () => {
  const input=JSON.parse(await readFile(new URL('../../examples/placement-stress.json',import.meta.url),'utf8'));
  input.diagram.style={connection:{strokeColor:'#078',strokeWidth:4,lineStyle:'dashed'},module:{label:{fontSize:18,padding:4,backgroundColor:'#eee'},inputPortLabel:{fontSize:14,padding:2}}};
  input.layout.feedbackRouting='outer';const model=createDiagramModel(input),result=await layoutDiagram(model);
  for(const node of result.modules) {inside(node.labelBounds,node);for(const port of node.ports)inside(port.labelBounds,node);}
  for(const edge of result.connections) assert.deepEqual(edge.style,model.connections.find(c=>c.id===edge.id).style);
  assert.ok(renderSvg(result).includes('stroke-dasharray="16 8"'));
});
