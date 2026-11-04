import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { createDiagramModel, layoutDiagram, renderSvg } from '../../src/lib/index.js';
import { checkLayout, freeze } from './helpers.js';
const fixture = JSON.parse(await readFile(new URL('../../examples/grouped-feedback.json', import.meta.url), 'utf8'));

test('single-level groups validate without mutating raw data; ungrouped blocks remain roots', () => {
  const raw = structuredClone(fixture), before = structuredClone(raw);
  const model = createDiagramModel(freeze(raw));
  assert.deepEqual(raw, before);
  assert.deepEqual(model.groups[0].members, ['A', 'B']);
  assert.equal(model.groups[0].style.label.fontSize, 16);
  assert.equal(model.modules.length, 6);
});
for (const [name, change] of [
  ['non-array groups', d => { d.groups = null; }],
  ['duplicate group ID', d => { d.groups[1].id = d.groups[0].id; }],
  ['block/group ID collision', d => { d.groups[0].id = 'A'; }],
  ['unknown member', d => { d.groups[0].members.push('missing'); }],
  ['duplicate member', d => { d.groups[0].members.push('A'); }],
  ['multiple parents', d => { d.groups[1].members.push('A'); }],
  ['group cycle', d => { d.groups[0].members.push('auxiliary'); d.groups[1].members.push('pipeline'); d.groups[1].members.push('pipeline'); }],
  ['children field', d => { d.groups[0].children = []; }],
  ['invalid style', d => { d.groups[0].style = { portLabel: { unknown: 1 } }; }],
  ['empty label', d => { d.groups[0].label = ''; }],
]) test('reject group ' + name, () => {
  const raw = structuredClone(fixture); change(raw); assert.throws(() => createDiagramModel(raw));
});
function plain() {
  const raw = structuredClone(fixture); delete raw.diagram.style;
  for (const module of raw.modules) { delete module.style; for (const port of module.ports) delete port.style; }
  raw.layout.feedbackRouting = 'elk'; return raw;
}
for (const direction of ['right', 'left']) test('group containment, local/cross/root edges, fixed ports and exports ' + direction, async () => {
  const raw = plain(); raw.layout.direction = direction;
  const model = createDiagramModel(raw), before = structuredClone(model);
  const layout = await layoutDiagram(freeze(model));
  checkLayout(model, layout); assert.deepEqual(model, before);
  for (const group of layout.groups) {
    assert.ok(group.x >= 0 && group.y >= 0);
    assert.ok(group.x + group.width <= layout.width + 1e-6);
    assert.ok(group.y + group.height <= layout.height + 1e-6);
    for (const id of group.members) {
      const node = layout.modules.find(node => node.id === id);
      assert.ok(node.x >= group.x && node.y > group.labelBounds.y + group.labelBounds.height);
      assert.ok(node.x + node.width <= group.x + group.width);
      assert.ok(node.y + node.height <= group.y + group.height);
    }
  }
  const svg = renderSvg(layout);
  assert.ok(svg.indexOf('data-role="group"') < svg.indexOf('<path'));
  assert.ok(svg.includes('Pipeline'));
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  assert.ok((await sharp(png).metadata()).width > 0);
});

test('empty group and large escaped title fit their bounds without any blocks', async () => {
  const raw = { version: 1, diagram: { name: 'Empty groups' }, modules: [], groups: [{ id: 'g', members: [], label: 'Group <&> ' + 'long '.repeat(20), style: { borderWidth: 10, label: { fontSize: 24, padding: 8, backgroundColor: '#eee' } } }] };
  const layout = await layoutDiagram(createDiagramModel(raw));
  const group = layout.groups[0];
  assert.ok(group.labelBounds.x >= group.x);
  assert.ok(group.labelBounds.x + group.labelBounds.width <= group.x + group.width);
  assert.ok(group.labelBounds.y + group.labelBounds.height <= group.y + group.height);
  assert.ok(renderSvg(layout).includes('&lt;&amp;&gt;'));
});

test('groups support once layout with outer feedback', async () => {
  const raw = plain(); raw.layout.feedbackRouting = 'outer';
  const model = createDiagramModel(raw); checkLayout(model, await layoutDiagram(model));
});
