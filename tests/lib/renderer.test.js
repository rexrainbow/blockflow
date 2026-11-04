import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMParser } from '@xmldom/xmldom';
import { createDiagramModel, layoutDiagram, renderSvg } from '../../src/lib/index.js';
import { fixture, freeze } from './helpers.js';

function parse(svg) {
  const errors = [];
  const doc = new DOMParser({ onError: (level, message) => errors.push(`${level}: ${message}`) }).parseFromString(svg, 'image/svg+xml');
  assert.deepEqual(errors, []);
  return doc;
}

test('valid XML, escapes text, correct geometry and rendering order, deterministic and immutable', async () => {
  const input = fixture();
  input.modules[0].label = '硬體 <A&B> "test\'s"';
  input.modules[0].ports.push({ id: 'bus', direction: 'output', width: 8 });
  input.modules[1].ports.push({ id: 'bus', direction: 'input', width: 8 });
  input.connections.push({ from: 'a.bus', to: 'b.bus' });
  const layout = await layoutDiagram(createDiagramModel(input));
  const before = structuredClone(layout);
  const svg = renderSvg(freeze(layout));
  assert.equal(renderSvg(layout), svg);
  assert.deepEqual(layout, before);
  const doc = parse(svg);
  const root = doc.documentElement;
  assert.equal(root.localName, 'svg');
  assert.equal(root.namespaceURI, 'http://www.w3.org/2000/svg');
  assert.equal(root.getAttribute('width'), String(layout.width + 40));
  assert.equal(root.getAttribute('height'), String(layout.height + 40));
  assert.equal(root.getAttribute('viewBox'), `-20 -20 ${layout.width + 40} ${layout.height + 40}`);
  const rects = Array.from(doc.getElementsByTagName('rect'));
  assert.equal(rects.length, layout.modules.length + 1);
  assert.equal(rects[0].getAttribute('x'), '-20');
  assert.equal(rects[0].getAttribute('width'), root.getAttribute('width'));
  const texts = Array.from(doc.getElementsByTagName('text'));
  assert.equal(texts[0].textContent, input.modules[0].label);
  assert.equal(texts.length, layout.modules.length + layout.modules.reduce((sum, m) => sum + m.ports.length, 0));
  assert.ok(texts.some(text => text.textContent === 'bus[7:0]'));
  assert.ok(svg.includes('&lt;A&amp;B&gt; &quot;test&apos;s&quot;'));
  const paths = Array.from(doc.getElementsByTagName('path'));
  assert.deepEqual(paths.map(path => path.getAttribute('stroke-width')), ['1.5', '2.5']);
  const body = rects[1];
  assert.equal(Number(body.getAttribute('x')) - 0.5, layout.modules[0].x);
  assert.equal(Number(body.getAttribute('width')) + 1, layout.modules[0].width);
  assert.ok(svg.indexOf('<path') < svg.indexOf('<rect', svg.indexOf('</g>')));
  assert.equal(doc.getElementsByTagName('script').length, 0);
});

test('each edge section is drawn independently with original bend points', () => {
  const layout = {
    width: 100, height: 60, modules: [],
    connections: [{ id: 'c', width: 1, sections: [
      { points: [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 30 }] },
      { points: [{ x: 40, y: 30 }, { x: 100, y: 30 }] },
    ] }],
  };
  const paths = Array.from(parse(renderSvg(layout)).getElementsByTagName('path'));
  assert.deepEqual(paths.map(path => path.getAttribute('d')), ['M 0 0 L 40 0 L 40 30', 'M 40 30 L 100 30']);
});

test('diagram without connections remains valid SVG', async () => {
  const input = fixture(); input.connections = [];
  const doc = parse(renderSvg(await layoutDiagram(createDiagramModel(input))));
  assert.equal(doc.getElementsByTagName('path').length, 0);
  assert.equal(doc.getElementsByTagName('rect').length, 3);
});
