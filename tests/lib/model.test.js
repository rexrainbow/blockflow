import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiagramModel, DiagramValidationError } from '../../src/lib/index.js';
import { fixture, freeze } from './helpers.js';

test('normalize defaults, same-side order, bus names; no input references', () => {
  const input = fixture();
  input.modules[0].ports.unshift({ id: 'bus', direction: 'output', width: 8 });
  const before = structuredClone(input);
  const model = createDiagramModel(freeze(input));
  assert.deepEqual(input, before);
  assert.equal(model.modules[0].label, 'a');
  assert.equal(model.modules[0].ports[0].displayName, 'bus[7:0]');
  assert.deepEqual(model.modules[0].ports.map(p => p.order), [0, 0, 1]);
  assert.equal(model.modules[0].ports[1].width, null);
  assert.equal(model.modules[0].ports[0].side, 'right');
  assert.equal(model.connections[0].id, 'connection_0');
  assert.deepEqual(model.layout, { direction: 'right', routing: 'orthogonal', placement: 'default', feedbackRouting: 'elk', feedbackMargin: 20, feedbackLaneSpacing: 12, moduleSpacing: 50, layerSpacing: 80 });
  model.modules[0].ports[0].id = 'changed';
  model.diagram.name = 'changed';
  assert.deepEqual(input, before);
});

test('optional connections and partial layout defaults', () => {
  const input = fixture(); delete input.connections; input.layout = { direction: 'left' };
  const model = createDiagramModel(input);
  assert.deepEqual(model.connections, []);
  assert.equal(model.layout.layerSpacing, 80);
});

for (const placement of ['default', 'relaxed', 'simple']) test(`accept placement ${placement}`, () => {
  const input = fixture(); input.layout = { placement };
  const model = createDiagramModel(input);
  assert.equal(model.layout.placement, placement);
  assert.equal(model.layout.direction, 'right');
});

test('fan-out, direct and cross-block feedback are valid', () => {
  const input = fixture();
  input.connections.push({ from: 'a.o', to: 'a.i' });
  assert.equal(createDiagramModel(input).connections.length, 2);
  input.connections[1] = { from: 'b.o', to: 'a.i' };
  assert.equal(createDiagramModel(input).connections.length, 2);
});

const invalid = [
  ['wrong version', v => v.version = 2, 'version'],
  ['empty name', v => v.diagram.name = '  ', 'diagram.name'],
  ['newline diagram name', v => v.diagram.name = 'a\nb', 'diagram.name'],
  ['XML control', v => v.modules[0].label = '\u0000', 'modules[0].label'],
  ['lone surrogate', v => v.modules[0].label = '\ud800', 'modules[0].label'],
  ['null label', v => v.modules[0].label = null, 'modules[0].label'],
  ['empty modules', v => v.modules = [], 'modules'],
  ['empty ports', v => v.modules[0].ports = [], 'modules[0].ports'],
  ['duplicate modules', v => v.modules.push(structuredClone(v.modules[0])), 'modules[2].id'],
  ['invalid module ID', v => v.modules[0].id = 'x.y', 'modules[0].id'],
  ['invalid port ID', v => v.modules[0].ports[0].id = 'x.y', 'modules[0].ports[0].id'],
  ['ID trailing newline', v => v.modules[0].id = 'a\n', 'modules[0].id'],
  ['duplicate ports', v => v.modules[0].ports.push({ ...v.modules[0].ports[0] }), 'modules[0].ports[2].id'],
  ['inout', v => v.modules[0].ports[0].direction = 'inout', 'modules[0].ports[0].direction'],
  ['zero width', v => v.modules[0].ports[0].width = 0, 'modules[0].ports[0].width'],
  ['unsafe width', v => v.modules[0].ports[0].width = 2 ** 53, 'modules[0].ports[0].width'],
  ['null width', v => v.modules[0].ports[0].width = null, 'modules[0].ports[0].width'],
  ['unknown port', v => v.connections[0].to = 'b.nope', 'connections[0].to'],
  ['invalid endpoint', v => v.connections[0].to = 'b.i.x', 'connections[0].to'],
  ['endpoint trailing newline', v => v.connections[0].to = 'b.i\n', 'connections[0].to'],
  ['input source', v => v.connections[0].from = 'a.i', 'connections[0].from'],
  ['output target', v => v.connections[0].to = 'b.o', 'connections[0].to'],
  ['width mismatch', v => { v.modules[0].ports[1].width = 8; v.modules[1].ports[0].width = 1; }, 'connections[0].to'],
  ['duplicate connection', v => v.connections.push({ ...v.connections[0] }), 'connections[1]'],
  ['multiple drivers', v => v.connections.push({ from: 'b.o', to: 'b.i' }), 'connections[1].to'],
  ['unknown root property', v => v.theme = {}, 'theme'],
  ['unknown nested property', v => v.modules[0].ports[0].side = 'left', 'modules[0].ports[0].side'],
  ['null layout', v => v.layout = null, 'layout'],
  ['bad direction', v => v.layout = { direction: 'up' }, 'layout.direction'],
  ['bad routing', v => v.layout = { routing: 'spline' }, 'layout.routing'],
  ['bad placement', v => v.layout = { placement: 'aligned' }, 'layout.placement'],
  ['null placement', v => v.layout = { placement: null }, 'layout.placement'],
  ['infinite spacing', v => v.layout = { moduleSpacing: Infinity }, 'layout.moduleSpacing'],
  ['string spacing', v => v.layout = { layerSpacing: '50' }, 'layout.layerSpacing'],
];
for (const [name, mutate, path] of invalid) test(`reject ${name}`, () => {
  const input = fixture(); mutate(input);
  assert.throws(() => createDiagramModel(input), error => error instanceof DiagramValidationError && error.path === path);
});

for (const value of [null, [], 'json', 5]) test(`reject non-object ${JSON.stringify(value)}`, () => {
  assert.throws(() => createDiagramModel(value), DiagramValidationError);
});

for (const value of [null, [], [{ id: 'row', members: ['a', 'b'] }]]) test(`reject removed alignmentGroups ${JSON.stringify(value)}`, () => {
  const input = fixture(); input.alignmentGroups = value;
  assert.throws(() => createDiagramModel(input), error => error instanceof DiagramValidationError && error.path === 'alignmentGroups');
});
