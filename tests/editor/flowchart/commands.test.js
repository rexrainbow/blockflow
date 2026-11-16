import test from 'node:test';
import assert from 'node:assert/strict';
import * as c from '../../../src/editor/flowchart/commands.js';
import { parseMermaid } from '../../../src/lib/flowchart/index.js';

const base = () => ({
  version: 1,
  diagram: { name: 'Edit' },
  nodes: [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
  edges: [
    { from: 'A', to: 'B' },
    { from: 'B', to: 'C' },
  ],
});
const reject = (fn, path) =>
  assert.throws(fn, (e) => typeof e.path === 'string' && (!path || e.path === path));
function unchanged(d, fn) {
  const before = structuredClone(d);
  fn();
  assert.deepEqual(d, before);
}

test('starter and new nodes are valid authoring JSON; edits are immutable and IDs are fresh', () => {
  const start = c.emptyDocument();
  c.validateDocument(start);
  const d = base();
  unchanged(d, () => {
    const next = c.addNode(d, { type: 'decision', label: 'Continue?', style: { fillColor: '#fff' } });
    assert.equal(next.nodes.at(-1).id, 'Node1');
    assert.equal(next.nodes.at(-1).label, 'Continue?');
    assert.equal(c.addNode(next, {}).nodes.at(-1).id, 'Node2');
    assert.equal(d.nodes.length, 3);
  });
  reject(() => c.addNode(d, { type: 'bad' }));
  reject(() => c.addNode(d, null), 'nodes');
  reject(() => c.addEdge(d, 'A', 'B', []), 'edges');
  reject(() => c.addNode(d, {}, 'Unknown'));
  reject(() => c.addNode(d, { type: 'note' }));
  reject(() => c.removeNode(start, 'Start'), 'nodes');
});

test('renaming cascades references, preserves labels, and rejects collisions atomically', () => {
  const d = base();
  d.nodes.push({ id: 'N', type: 'note', attachTo: 'A' });
  d.groups = [{ id: 'G', members: ['A', 'N'] }];
  unchanged(d, () => {
    const next = c.renameNode(d, 'A', 'Renamed');
    assert.equal(next.edges[0].from, 'Renamed');
    assert.equal(next.nodes.at(-1).attachTo, 'Renamed');
    assert.deepEqual(next.groups[0].members, ['Renamed', 'N']);
    reject(() => c.renameNode(d, 'A', 'B'));
    reject(() => c.renameNode(d, 'A', 'bad id'));
    reject(() => c.renameNode(d, 'Missing', 'New'));
  });
  d.groups.push({ id: 'Outer', members: ['G'] });
  assert.deepEqual(c.renameGroup(d, 'G', 'Inner').groups[1].members, ['Inner']);
  reject(() => c.renameGroup(d, 'G', 'A'));
});

test('edge edits preserve implicit identities, create unique explicit IDs, and validate endpoints', () => {
  const d = base();
  unchanged(d, () => {
    const removed = c.removeEdge(d, 'edge_1');
    assert.equal(removed.edges[0].id, 'edge_2');
    const next = c.addEdge(d, 'C', 'A', { label: 'again', kind: 'loop', id: 'ignored' });
    assert.deepEqual(
      next.edges.map((e) => e.id),
      ['edge_1', 'edge_2', 'edge_3'],
    );
    assert.equal(c.reconnectEdge(d, 'edge_2', 'to', 'A').edges[1].to, 'A');
    reject(() => c.reconnectEdge(d, 'edge_1', 'wrong', 'A'));
    reject(() => c.reconnectEdge(d, 'Unknown', 'to', 'A'));
    reject(() => c.addEdge(d, 'Missing', 'A'));
    reject(() => c.removeEdge(d, 'Unknown'));
  });
  const parsed = parseMermaid('flowchart TD\n A --> B\n B --> C');
  c.validateDocument(c.addEdge(parsed, 'C', 'A'));
});

test('removing an owner removes explicit/inferred notes, incident edges and recursively empty groups', () => {
  const d = base();
  d.nodes.push({ id: 'N', type: 'note' });
  d.edges.push({ from: 'N', to: 'A', kind: 'association' });
  d.groups = [
    { id: 'Inner', members: ['A', 'N'] },
    { id: 'Outer', members: ['Inner'] },
  ];
  unchanged(d, () => {
    const next = c.removeNode(d, 'A');
    assert.deepEqual(
      next.nodes.map((n) => n.id),
      ['B', 'C'],
    );
    assert.deepEqual(next.groups, []);
    assert.deepEqual(next.edges, [{ id: 'edge_2', from: 'B', to: 'C' }]);
    const keep = c.removeEdge(d, 'edge_3');
    assert.equal(keep.nodes.at(-1).attachTo, 'A');
  });
});

test('grouping/ungrouping and placement keep notes with owners and preserve nested membership', () => {
  const d = base();
  d.nodes.push({ id: 'N', type: 'note', attachTo: 'A' });
  let next = c.addGroup(d, ['A']);
  assert.deepEqual(next.groups[0].members, ['A', 'N']);
  next = c.addGroup(next, ['B'], 'Group1');
  assert.deepEqual(next.groups[0].members, ['A', 'N', 'Group2']);
  next = c.placeNode(next, 'A', 'Group2');
  assert.deepEqual(next.groups[1].members, ['B', 'A', 'N']);
  reject(() => c.placeNode(next, 'N', null));
  next = c.ungroup(next, 'Group2');
  assert.deepEqual(next.groups[0].members, ['B', 'A', 'N']);
  next = c.placeNode(next, 'A', null);
  assert.deepEqual(next.groups[0].members, ['B']);
  reject(() => c.addGroup(d, ['N']));
  reject(() => c.addGroup(d, []));
  reject(() => c.addGroup(d, ['A', 'A']));
  reject(() => c.addGroup(d, ['Missing']));
  reject(() => c.addGroup(c.addGroup(d, ['A']), ['Group1'], 'Group1'));
  reject(() => c.ungroup(d, 'Missing'));
});

test('attaching notes moves membership, validates side/ownership and rejects a second note', () => {
  let d = base();
  d.nodes.push({ id: 'N', type: 'note', attachTo: 'A' });
  d = c.addGroup(d, ['B']);
  unchanged(d, () => {
    const next = c.attachNote(d, 'N', 'B', 'left');
    assert.equal(next.nodes.at(-1).attachTo, 'B');
    assert.equal(next.nodes.at(-1).side, 'left');
    assert.deepEqual(next.groups[0].members, ['B', 'N']);
    reject(() => c.attachNote(d, 'N', 'B', 'invalid'));
    reject(() => c.attachNote(d, 'A', 'B'));
    reject(() => c.attachNote(d, 'N', 'N'));
  });
  const next = c.addNode(d, { type: 'note', label: 'Second', attachTo: 'C' });
  reject(() => c.attachNote(next, 'Node1', 'A'));
});

function nestedGroups() {
  const d = base();
  d.nodes.push({ id: 'N', type: 'note', attachTo: 'A' });
  d.groups = [
    { id: 'Inner', label: 'Keep me', style: { fillColor: '#fff' }, members: ['A', 'N'] },
    { id: 'Middle', members: ['Inner'] },
    { id: 'Outer', members: ['Middle'] },
    { id: 'Target', members: ['B'] },
  ];
  return d;
}
test('placeGroup moves a subtree with notes, preserves authoring data and prunes empty ancestors', () => {
  const d = nestedGroups();
  unchanged(d, () => {
    const next = c.placeGroup(d, 'Inner', 'Target');
    assert.deepEqual(
      next.groups.map((g) => g.id),
      ['Inner', 'Target'],
    );
    assert.deepEqual(next.groups[0], d.groups[0]);
    assert.deepEqual(next.groups[1].members, ['B', 'Inner']);
    assert.deepEqual(next.nodes, d.nodes);
    assert.deepEqual(next.edges, d.edges);
    assert.notEqual(next.groups[0], d.groups[0]);
  });
});
test('placeGroup supports root, ancestor, sibling and unchanged placements without reordering', () => {
  const d = nestedGroups();
  const root = c.placeGroup(d, 'Inner');
  assert.deepEqual(
    root.groups.map((g) => g.id),
    ['Inner', 'Target'],
  );
  const ancestor = c.placeGroup(d, 'Inner', 'Outer');
  assert.deepEqual(
    ancestor.groups.map((g) => g.id),
    ['Inner', 'Outer', 'Target'],
  );
  assert.deepEqual(ancestor.groups.find((g) => g.id === 'Outer').members, ['Inner']);
  const same = c.placeGroup(d, 'Inner', 'Middle');
  assert.deepEqual(same, d);
  assert.notEqual(same, d);
  assert.deepEqual(c.placeGroup(d, 'Outer', null), d);
  const sibling = c.placeGroup(c.placeGroup(d, 'Target', 'Outer'), 'Inner', 'Target');
  assert.deepEqual(sibling.groups.find((g) => g.id === 'Outer').members, ['Target']);
});
test('placeGroup rejects missing groups, node targets and direct/indirect cycles atomically', () => {
  const d = nestedGroups();
  unchanged(d, () => {
    for (const [id, target] of [
      ['Missing', null],
      ['A', null],
      ['Inner', 'Missing'],
      ['Inner', 'B'],
      ['Inner', 'Inner'],
      ['Outer', 'Inner'],
      ['Middle', 'Inner'],
    ])
      reject(() => c.placeGroup(d, id, target));
  });
});
