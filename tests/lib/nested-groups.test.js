import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { createDiagramModel, layoutDiagram, renderSvg } from '../../src/lib/index.js';
import { ancestors, descendants } from '../../src/lib/hierarchy.js';
import { checkLayout, freeze } from './helpers.js';
const fixture = JSON.parse(await readFile(new URL('../../examples/nested-groups.json', import.meta.url), 'utf8'));
for (const direction of ['right','left']) test('nested groups: absolute containers, ancestor geometry and parent-first painting ' + direction, async () => {
  const raw = structuredClone(fixture); delete raw.diagram.style;
  for (const m of raw.modules) { delete m.style; for (const p of m.ports) delete p.style; }
  raw.layout.direction = direction; raw.layout.feedbackRouting = 'elk';
  const model = createDiagramModel(raw), before = structuredClone(model);
  const layout = await layoutDiagram(freeze(model)); checkLayout(model, layout); assert.deepEqual(model, before);
  for (const group of layout.groups) for (const id of group.members) {
    const child = [...layout.modules, ...layout.groups].find(item => item.id === id);
    assert.ok(child.x >= group.x && child.y > group.labelBounds.y + group.labelBounds.height);
    assert.ok(child.x + child.width <= group.x + group.width + 1e-6);
    assert.ok(child.y + child.height <= group.y + group.height + 1e-6);
  }
  assert.deepEqual(ancestors(model, 'A'), ['system','core','pipeline']);
  assert.ok(descendants(model, 'system').has('A'));
  assert.deepEqual(layout.groups.map(g => g.id), ['system','core','pipeline','auxiliary']);
  const svg = renderSvg(layout); assert.ok(svg.indexOf('data-group="system"') < svg.indexOf('data-group="pipeline"'));
  assert.equal((await sharp(await sharp(Buffer.from(svg)).png().toBuffer()).metadata()).format, 'png');
});
test('self and indirect group cycles, unknown children and group multi-parenting fail validation', () => {
  for (const change of [
    d => d.groups.push({id:'loop',members:['loop']}),
    d => { d.groups.find(g=>g.id==='system').members=[]; d.groups[0].members.push('core'); },
    d => d.groups[1].members.push('missing'),
    d => d.groups.find(g=>g.id==='system').members.push('pipeline'),
  ]) { const raw=structuredClone(fixture); change(raw); assert.throws(()=>createDiagramModel(raw)); }
});
