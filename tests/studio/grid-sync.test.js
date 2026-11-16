import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { reconcileGrids } from '../../src/lib/blockchart/grid.js';
import { createDiagramModel } from '../../src/lib/index.js';
import { placeBlock, removeGroup, setGroupType } from '../../src/editor/blockchart/commands.js';
import {
  addBlock,
  deleteSelection,
  duplicateBlock,
  groupItems,
  deleteGroupDeep,
} from '../../src/studio/blockchart/state/actions.js';
import { syncGridMembership } from '../../src/studio/blockchart/state/grid-sync.js';

const source = JSON.parse(
  await readFile(new URL('../../examples/blockchart/processor-cross-group-grid.json', import.meta.url), 'utf8'),
);
// Clock      ALU0  .
// Controller ALU1  ALU2
// .          ALU4  ALU3      (ComputeCluster expanded: ALU0..ALU4)

/** Run a command the way Store.commit does and return the root cells. */
function run(change, doc = structuredClone(source)) {
  const before = structuredClone(doc);
  change(doc);
  syncGridMembership(before, doc);
  reconcileGrids(doc);
  assert.doesNotThrow(() => createDiagramModel(structuredClone(doc)));
  return doc;
}

test('deleting placed blocks leaves empty cells', () => {
  assert.deepEqual(run((d) => deleteSelection(d, { type: 'block', id: 'Clock' })).layout.cells[0], [
    null,
    'ALU0',
    null,
  ]);
  assert.deepEqual(run((d) => deleteSelection(d, { type: 'block', id: 'ALU0' })).layout.cells[0], [
    'Clock',
    null,
    null,
  ]);
  const gone = run((d) => deleteGroupDeep(d, 'ComputeCluster'));
  assert.deepEqual(gone.layout.cells, [
    ['Clock', null, null],
    ['Controller', null, null],
    [null, null, null],
  ]);
});

test('new and duplicated children of an expanded Container fill its rectangle, then grow it', () => {
  let doc = run((d) => addBlock(d, 'block', 'ComputeCluster'));
  assert.deepEqual(doc.layout.cells[0], ['Clock', 'ALU0', 'block_1']);
  doc = run((d) => duplicateBlock(d, 'ALU1'), doc);
  assert.equal(doc.layout.cells.length, 4);
  assert.deepEqual(doc.layout.cells[3], [null, 'ALU1_1', null]);
});

test('Down flow grows an expanded Container by a column', () => {
  const down = structuredClone(source);
  down.layout.direction = 'down';
  down.layout.cells[0][2] = null;
  const full = run((d) => addBlock(d, 'block', 'ComputeCluster'), down);
  const doc = run((d) => addBlock(d, 'block', 'ComputeCluster'), full);
  assert.equal(doc.layout.cells[0].length, 4);
  assert.equal(doc.layout.cells[0][3], 'block_2');
});

test('moving blocks in or out of an expanded Container keeps the Grid valid', () => {
  const into = run((d) => placeBlock(d, 'Clock', 'ComputeCluster'));
  assert.deepEqual(into.layout.cells[0], [null, 'ALU0', 'Clock']);
  const out = run((d) => placeBlock(d, 'ALU0', ''));
  assert.deepEqual(out.layout.cells[0], ['Clock', null, null]);
  assert.ok(!out.groups[0].layout?.cells?.flat().includes('ALU0'));
});

test('ungrouping keeps expanded children in place; an atomic group cell becomes empty', () => {
  const flat = run((d) => removeGroup(d, 'ComputeCluster'));
  assert.deepEqual(flat.layout.cells, source.layout.cells);
  const tile = structuredClone(source);
  tile.layout.cells = [
    ['Clock', 'ComputeCluster'],
    ['Controller', null],
  ];
  assert.deepEqual(run((d) => removeGroup(d, 'ComputeCluster'), tile).layout.cells, [
    ['Clock', null],
    ['Controller', null],
  ]);
});

test('a Container that can no longer expand folds into its top-left cell', () => {
  const doc = run((d) => setGroupType(d, 'ComputeCluster', 'collection'));
  assert.deepEqual(doc.layout.cells, [
    ['Clock', 'ComputeCluster', null],
    ['Controller', null, null],
    [null, null, null],
  ]);
});

test('grouping placed items puts the new group in the first item cell', () => {
  const doc = run((d) => groupItems(d, ['Clock', 'Controller']));
  assert.deepEqual(doc.layout.cells[0], ['group_1', 'ALU0', null]);
  assert.equal(doc.layout.cells[1][0], null);
});

test('edits that keep membership never repair typed cells', () => {
  const doc = structuredClone(source);
  const before = structuredClone(doc);
  doc.layout.cells = [['Clock', 'Missing', 'ComputeCluster', 'ALU0']];
  syncGridMembership(before, doc);
  assert.deepEqual(doc.layout.cells, [['Clock', 'Missing', 'ComputeCluster', 'ALU0']]);
  assert.throws(() => reconcileGrids(doc));
});
