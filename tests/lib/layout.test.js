import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDiagramModel, layoutDiagram, DiagramLayoutError } from '../../src/lib/index.js';
import { fixture, freeze, checkLayout } from './helpers.js';

for (const direction of ['right', 'left']) {
  for (const name of ['uart-data-path', 'direct-feedback', 'cyclic-feedback']) test(`${name} ${direction}: bounds, anchors, routes and no mutation`, async () => {
    const input = JSON.parse(await readFile(new URL(`../../examples/${name}.json`, import.meta.url), 'utf8'));
    input.layout = { ...input.layout, direction };
    const model = createDiagramModel(input);
    const before = structuredClone(model);
    const layout = await layoutDiagram(freeze(model));
    assert.deepEqual(model, before);
    checkLayout(model, layout);
  });

  test(`two-block feedback ${direction}`, async () => {
    const input = fixture(); input.layout = { direction };
    input.connections.push({ from: 'b.o', to: 'a.i' });
    const model = createDiagramModel(input);
    checkLayout(model, await layoutDiagram(model));
  });

  test(`fan-out and isolated nodes ${direction}`, async () => {
    const input = fixture(); input.layout = { direction };
    input.modules.push(
      { id: 'c', ports: [{ id: 'i', direction: 'input' }] },
      { id: 'isolated', ports: [{ id: 'o', direction: 'output' }] },
    );
    input.connections.push({ from: 'a.o', to: 'c.i' });
    const model = createDiagramModel(input);
    checkLayout(model, await layoutDiagram(model));
  });
}

test('no connections; long, Unicode labels and mixed port order', async () => {
  const input = fixture(); input.connections = [];
  input.modules[0].label = '硬體處理方塊_'.repeat(15);
  input.modules[0].ports = [
    { id: 'out_first', direction: 'output' },
    { id: 'input_with_a_long_name', direction: 'input', width: 32 },
    { id: 'out_second', direction: 'output' },
    { id: 'in_second', direction: 'input' },
  ];
  const model = createDiagramModel(input);
  const layout = await layoutDiagram(model);
  checkLayout(model, layout);
  assert.ok(layout.modules[0].width > 1000);
});

test('left direction places target before source while keeping fixed port sides', async () => {
  const input = fixture(); input.layout = { direction: 'left' };
  const model = createDiagramModel(input);
  const layout = await layoutDiagram(model);
  checkLayout(model, layout);
  assert.ok(layout.modules[1].x < layout.modules[0].x);
});

test('user IDs cannot collide with internal graph IDs', async () => {
  const input = fixture(); input.modules[0].id = 'connection_0'; input.modules[1].id = '__diagram_root__';
  input.connections = [{ from: 'connection_0.o', to: '__diagram_root__.i' }];
  const model = createDiagramModel(input);
  checkLayout(model, await layoutDiagram(model));
});

test('layout failure preserves cause', async () => {
  await assert.rejects(layoutDiagram(null), error => error instanceof DiagramLayoutError && error.cause instanceof Error);
});
