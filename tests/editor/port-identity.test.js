import test from 'node:test';
import assert from 'node:assert/strict';
import { renamePort } from '../../src/editor/state/commands.js';
import { History } from '../../src/editor/state/history.js';
import { createDiagramModel } from '../../src/lib/model.js';

test('port key suffixing updates references and preserves explicit display labels in one undo', () => {
  const raw = {
    version: 1,
    diagram: { name: 'Ports' },
    modules: [
      {
        id: 'A',
        ports: [
          { id: 'in', direction: 'input' },
          { id: 'out', direction: 'output', label: 'Data\nChannel A' },
          { id: 'in_2', direction: 'input' },
        ],
      },
      { id: 'B', ports: [{ id: 'in', direction: 'input' }] },
    ],
    connections: [
      { from: 'A.out', to: 'A.in' },
      { from: 'A.out', to: 'B.in' },
    ],
  };
  const history = new History(raw);
  let result;
  history.update((doc) => {
    result = renamePort(doc, 'A', 'out', 'in');
  });
  assert.deepEqual(result, { id: 'in_3', requested: 'in', adjusted: true });
  assert.equal(history.present.modules[0].ports[1].label, 'Data\nChannel A');
  assert.ok(history.present.connections.every((edge) => edge.from === 'A.in_3'));
  createDiagramModel(history.present);
  history.undo();
  assert.deepEqual(history.present, raw);
  history.redo();
  assert.equal(history.present.connections[0].from, 'A.in_3');
  const before = structuredClone(history.present);
  assert.throws(() => history.update((doc) => renamePort(doc, 'A', 'in_3', 'bad.key')));
  assert.deepEqual(history.present, before);
});
