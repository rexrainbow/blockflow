import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv from 'ajv/dist/2020.js';
import { DOMParser } from '@xmldom/xmldom';
import sharp from 'sharp';
import { alignedTextPosition, textBounds } from '../../src/lib/shared/text.js';
import { createDiagramModel, layoutDiagram, renderSvg } from '../../src/lib/blockchart/index.js';
import { createFlowchartModel, layoutFlowchart, renderFlowchartSvg } from '../../src/lib/flowchart/index.js';
import {
  createStatechartModel,
  layoutStatechart,
  renderStatechartSvg,
} from '../../src/lib/statechart/index.js';
const read = async (p) => JSON.parse(await readFile(new URL(p, import.meta.url), 'utf8'));
function stripAlignment(value) {
  if (Array.isArray(value)) return value.map(stripAlignment);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k]) => !['textAlign', 'descriptionAlign'].includes(k))
        .map(([k, v]) => [k, stripAlignment(v)]),
    );
  return value;
}
function setAlignment(value, align) {
  if (Array.isArray(value)) value.forEach((v) => setAlignment(v, align));
  else if (value && typeof value === 'object')
    for (const [k, v] of Object.entries(value)) {
      if (k === 'textAlign' || k === 'descriptionAlign') value[k] = align;
      else setAlignment(v, align);
    }
  return value;
}
const domains = [
  ['blockchart', createDiagramModel, layoutDiagram, renderSvg],
  ['flowchart', createFlowchartModel, layoutFlowchart, renderFlowchartSvg],
  ['statechart', createStatechartModel, layoutStatechart, renderStatechartSvg],
];
test('alignment preserves measured bounds at start/middle/end anchors, padding and single-line placement', () => {
  const value = 'Longest line\nx\n',
    style = { fontSize: 15, padding: 7 };
  for (const anchor of ['start', 'middle', 'end'])
    for (const align of ['left', 'center', 'right']) {
      const position = { x: 100, y: 40, anchor },
        next = alignedTextPosition(value, position, style, align);
      assert.deepEqual(textBounds(value, next, style), textBounds(value, position, style));
      assert.equal(next.anchor, { left: 'start', center: 'middle', right: 'end' }[align]);
      assert.equal(alignedTextPosition('Single', position, style, align), position);
      assert.equal(alignedTextPosition(value, position, style), position);
    }
});
for (const [domain, model, layout, render] of domains) {
  test(`${domain}: schema/model inheritance, geometry invariance, valid SVG and PNG`, async () => {
    const raw = await read(`../../examples/text-alignment/${domain}.json`),
      before = structuredClone(raw),
      schema = await read(`../../schema/${domain}.schema.json`),
      validate = new Ajv({ strict: true }).compile(schema);
    assert.equal(validate(raw), true, JSON.stringify(validate.errors));
    model(raw);
    const base = await layout(model(stripAlignment(raw))),
      resolved = await layout(model(raw));
    assert.deepEqual(stripAlignment(resolved), stripAlignment(base));
    const images = new Set();
    for (const align of ['left', 'center', 'right']) {
      const candidate = setAlignment(structuredClone(raw), align),
        result = await layout(model(candidate));
      assert.deepEqual(stripAlignment(result), stripAlignment(base));
      const svg = render(result),
        xml = new DOMParser().parseFromString(svg, 'image/svg+xml');
      assert.ok(xml.getElementsByTagName('text').length > 0);
      assert.doesNotMatch(svg, /NaN|undefined/);
      assert.ok((await sharp(Buffer.from(svg)).png().toBuffer()).length > 500);
      images.add(svg);
    }
    assert.equal(images.size, 3);
    assert.deepEqual(raw, before);
    if (domain === 'blockchart') {
      assert.equal(resolved.modules.find((n) => n.id === 'Source').style.label.textAlign, 'center');
      assert.equal(resolved.connections.find((e) => e.label).style.label.textAlign, 'left');
      assert.equal(resolved.terminals.find((n) => n.id === 'Done').style.textAlign, 'right');
    } else if (domain === 'flowchart') {
      assert.equal(resolved.nodes.find((n) => n.id === 'Work').style.textAlign, 'center');
      assert.equal(resolved.nodes.find((n) => n.id === 'Note').style.textAlign, 'left');
    } else {
      assert.equal(resolved.states.find((n) => n.id === 'Idle').style.descriptionAlign, 'left');
      assert.equal(resolved.states.find((n) => n.id === 'Active').style.descriptionAlign, 'right');
    }
  });
  test(`${domain}: schema/runtime reject invalid alignment values at the authored path`, async () => {
    const schema = await read(`../../schema/${domain}.schema.json`),
      validate = new Ajv({ strict: true }).compile(schema);
    for (const value of ['start', 'inherit', 'LEFT', '', null, 0, true]) {
      const raw = await read(`../../examples/text-alignment/${domain}.json`);
      const style =
        domain === 'blockchart'
          ? raw.diagram.style.text
          : domain === 'flowchart'
            ? raw.diagram.style.node
            : raw.diagram.style.state;
      style.textAlign = value;
      assert.equal(validate(raw), false);
      assert.throws(
        () => model(raw),
        (e) => e.path.endsWith('.textAlign'),
      );
    }
  });
}
test('Statechart descriptionAlign inherits textAlign, allows independent override, and is state-only', async () => {
  const raw = await read('../../examples/text-alignment/statechart.json');
  delete raw.diagram.style.state.descriptionAlign;
  delete raw.states[2].style.descriptionAlign;
  raw.diagram.style.state.textAlign = 'right';
  const layout = await layoutStatechart(raw),
    svg = renderStatechartSvg(layout);
  const texts = Array.from(
    new DOMParser().parseFromString(svg, 'image/svg+xml').getElementsByTagName('text'),
  );
  const body = texts.filter((n) => n.textContent.includes('output =') || n.textContent.includes('enable ='));
  assert.ok(body.length === 4 && body.every((n) => n.getAttribute('text-anchor') === 'end'));
  raw.diagram.style.state.descriptionAlign = null;
  assert.throws(
    () => createStatechartModel(raw),
    (e) => e.path === 'diagram.style.state.descriptionAlign',
  );
  delete raw.diagram.style.state.descriptionAlign;
  raw.transitions[0].style = { descriptionAlign: 'left' };
  assert.throws(
    () => createStatechartModel(raw),
    (e) => e.path.endsWith('.descriptionAlign'),
  );
});
