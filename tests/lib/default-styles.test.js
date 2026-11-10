import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv from 'ajv/dist/2020.js';
import { createDiagramModel, layoutDiagram, renderSvg } from '../../src/lib/index.js';
import { inheritedStyleValue } from '../../src/lib/blockchart/styles.js';
import { fixture, freeze } from './helpers.js';
const schema = JSON.parse(
  await readFile(new URL('../../schema/blockchart.schema.json', import.meta.url), 'utf8'),
);
const validate = new Ajv({ strict: true, allErrors: true }).compile(schema);

test('Common text cascades into every diagram text type, with property-by-property local overrides', async () => {
  const raw = fixture();
  raw.diagram.caption = 'Diagram caption';
  raw.diagram.style = {
    text: { fontSize: 19, color: '#123456', padding: 3 },
    module: { label: { color: '#654321' } },
    group: { label: { fontSize: 21 }, fillColor: '#ffeedd', borderRadius: 8, portLabel: { fontSize: 17 } },
    connection: { label: { fontSize: 18 } },
    terminal: { fontSize: 20 },
  };
  raw.modules[0].style = { label: { fontSize: 23 }, portLabel: { fontSize: 22 } };
  raw.groups = [{ id: 'G', members: ['a'], ports: [{ id: 'unused', direction: 'input' }], type: 'boundary' }];
  raw.connections = [];
  raw.terminals = [{ id: 'External', direction: 'input', style: { color: '#abcdef' } }];
  assert.equal(validate(raw), true, JSON.stringify(validate.errors));
  const before = structuredClone(raw),
    model = createDiagramModel(freeze(raw));
  assert.deepEqual(raw, before);
  assert.equal(model.modules[0].style.label.fontSize, 23);
  assert.equal(model.modules[0].style.label.color, '#654321');
  assert.equal(model.modules[1].style.label.fontSize, 19);
  assert.equal(model.modules[0].ports[0].style.fontSize, 22);
  assert.equal(model.groups[0].style.label.fontSize, 21);
  assert.equal(model.groups[0].style.label.color, '#123456');
  assert.equal(model.groups[0].style.borderRadius, 8);
  assert.equal(model.groups[0].ports[0].style.fontSize, 17);
  assert.equal(model.terminals[0].style.fontSize, 20);
  assert.equal(model.terminals[0].style.color, '#abcdef');
  const layout = await layoutDiagram(model);
  assert.equal(layout.caption.style.fontSize, 19);
  assert.match(renderSvg(layout), /font-size="19"/);
});

test('Net labels share resolved text defaults at both ends, while Port directional and local layers win', async () => {
  const raw = fixture();
  raw.diagram.style = {
    text: { fontSize: 16 },
    module: { portLabel: { fontSize: 17 }, inputPortLabel: { fontSize: 18 } },
    connection: { label: { fontSize: 20, repeatAtEnd: 'always' } },
  };
  raw.modules[1].style = { portLabel: { fontSize: 21 } };
  raw.modules[1].ports[0].style = { fontSize: 22 };
  raw.connections[0].label = 'Data';
  const model = createDiagramModel(raw);
  assert.equal(model.modules[0].ports[0].style.fontSize, 18);
  assert.equal(model.modules[1].ports[0].style.fontSize, 22);
  assert.equal(model.connections[0].style.label.fontSize, 20);
  const l = await layoutDiagram(model);
  assert.equal(l.connections[0].labelInstances.length, 2);
  assert.equal(l.warnings, undefined);
  const info = inheritedStyleValue(raw.diagram.style, 'port', '', raw.modules[1].ports[0].style, 'fontSize', {
    ownerStyle: raw.modules[1].style,
    direction: 'input',
    ownerLabel: 'Block b',
  });
  assert.deepEqual(info, { value: 21, source: 'Block b > All ports' });
});

test('Group defaults reach Collection virtual Ports and explicit false/zero keep precedence', async () => {
  const raw = fixture();
  raw.diagram.style = {
    text: { fontSize: 16, hidden: true },
    group: { label: { hidden: false }, portLabel: { fontSize: 18, hidden: false }, borderOpacity: 0 },
    terminal: { hidden: false, padding: 0 },
  };
  raw.groups = [{ id: 'G', members: ['a'], type: 'collection', collapsed: true }];
  raw.terminals = [{ id: 'Unused', direction: 'input' }];
  const model = createDiagramModel(raw),
    layout = await layoutDiagram(model);
  assert.equal(model.groups[0].style.label.hidden, false);
  assert.equal(model.groups[0].style.borderOpacity, 0);
  assert.equal(model.terminals[0].style.padding, 0);
  assert.ok(layout.groups[0].ports.every((p) => p.style.fontSize === 18 && !p.style.hidden));
});

test('Schema and model reject invalid defaults and accept omissions without changing authored JSON', () => {
  for (const style of [
    { text: { fontSize: 0 } },
    { terminal: { hidden: 'true' } },
    { group: { borderRadius: -1 } },
    { text: { startArrow: 'none' } },
    { unknown: {} },
  ]) {
    const raw = fixture();
    raw.diagram.style = style;
    assert.equal(validate(raw), false);
    assert.throws(() => createDiagramModel(raw));
  }
  const raw = fixture(),
    before = structuredClone(raw);
  createDiagramModel(raw);
  assert.deepEqual(raw, before);
});
