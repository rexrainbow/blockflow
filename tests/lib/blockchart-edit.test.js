import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inspectDiagram, applyDiagramOps } from '../../src/lib/blockchart/index.js';

const example = () =>
  JSON.parse(readFileSync(new URL('../../examples/blockchart/agent-edit-fanout.json', import.meta.url)));
const remove = { op: 'removeBranch', from: 'TimerA.out', to: 'Sampler.in' };

test('setGridCells moves a component between two Grids in a single batch and keeps layout settings', () => {
  const doc = example();
  const oldLayout = { type: 'grid', blockAlign: 'left', rowGap: 27, cells: [['TimerA', 'Sampler']] };
  doc.groups[0].layout = oldLayout;
  doc.groups.push({ id: 'Receive', members: ['Monitor'], layout: { type: 'auto', moduleSpacing: 15 } });
  const ops = [
    {
      op: 'setGridCells',
      id: 'Receive',
      cells: [
        ['Monitor', null],
        ['Sampler', 'FIFO'],
      ],
    },
    { op: 'addModule', module: { id: 'FIFO' } },
    { op: 'setGroupMembers', id: 'Receive', members: ['Monitor', 'Sampler', 'FIFO'] },
    { op: 'setGroupMembers', id: 'Bank0', members: ['TimerA'] },
    { op: 'setGridCells', id: 'Bank0', cells: [['TimerA', null]] },
  ];
  const result = applyDiagramOps(doc, ops);
  assert.deepEqual(result.document.groups[0].layout, { ...oldLayout, cells: [['TimerA', null]] });
  assert.deepEqual(result.document.groups[1].layout, {
    type: 'grid',
    moduleSpacing: 15,
    cells: ops[0].cells,
  });
  assert.deepEqual(result.document.connections, doc.connections);
  assert.deepEqual(applyDiagramOps(result.document, [ops[0], ops.at(-1)]).diff, []);
  assert.throws(() => applyDiagramOps(doc, ops.slice(0, -1)), /groups\[0\].layout.cells.*Sampler/);
  assert.deepEqual(doc.groups[0].layout.cells, [['TimerA', 'Sampler']]);
});

test('Net and branch patches preserve siblings, array order, shared attributes and nested style fields', () => {
  const doc = example();
  const net = doc.connections[0];
  net.style.label = { color: '#112233', fontSize: 10 };
  const operations = [
    { op: 'updateNet', id: 'Clock', patch: { label: 'Signal', style: { label: { fontSize: 14 } } } },
    {
      op: 'updateBranch',
      from: 'TimerA.out',
      to: 'Monitor.in',
      patch: { feedback: true, style: { opacity: 0.5 } },
    },
    { op: 'updateBranch', from: 'TimerA.out', to: 'Sampler.in', patch: { constraint: false } },
  ];
  const { document: out } = applyDiagramOps(doc, operations);
  assert.deepEqual(out.connections, [
    {
      ...net,
      label: 'Signal',
      style: { ...net.style, label: { color: '#112233', fontSize: 14 } },
      to: [
        { endpoint: 'Sampler.in', constraint: false },
        { ...net.to[1], feedback: true, style: { strokeWidth: 3, opacity: 0.5 } },
      ],
    },
  ]);
  assert.equal(net.to[0], 'Sampler.in');
  assert.deepEqual(applyDiagramOps(doc, [{ ...operations[2], patch: {} }]).diff, []);
  delete net.id;
  assert.equal(
    applyDiagramOps(doc, [{ op: 'updateNet', from: net.from, patch: { label: 'By source' } }]).document
      .connections[0].label,
    'By source',
  );
});

test('Grid and connection update errors identify the failed selector and leave the input intact', () => {
  const doc = example(),
    original = structuredClone(doc);
  const first = { op: 'updateNet', id: 'Clock', patch: { label: 'Changed' } };
  for (const [op, pattern] of [
    [{ op: 'setGridCells', id: 'Missing', cells: [[null]] }, /ops\[1\].*Missing/],
    [{ op: 'setGridCells', id: 'Bank0', cells: [['TimerA', 'Lost']] }, /Lost.*ops\[1\] setGridCells Bank0/],
    [{ op: 'setGridCells', id: 'Bank0', cells: [['TimerA'], []] }, /equal column counts/],
    [{ op: 'updateNet', id: 'Absent', patch: { label: 'Label' } }, /ops\[1\].*Absent/],
    [{ op: 'updateNet', id: 'Clock', patch: { to: [] } }, /Unexpected field: to/],
    [
      { op: 'updateBranch', from: 'TimerA.out', to: 'Absent.in', patch: {} },
      /ops\[1\].*TimerA.out -> Absent.in/,
    ],
    [
      { op: 'updateBranch', from: 'TimerA.out', to: 'Monitor.in', patch: { label: 'X' } },
      /Unexpected field: label/,
    ],
    [
      { op: 'updateBranch', from: 'TimerA.out', to: 'Monitor.in', patch: { feedback: 3 } },
      /Validation.*feedback/,
    ],
  ])
    assert.throws(() => applyDiagramOps(doc, [first, op]), pattern);
  assert.deepEqual(doc, original);
});

test('inspect classifies each destination, keeps raw overrides and traverses collapsed groups on request', () => {
  const doc = example();
  doc.groups.push({ id: 'Inner', type: 'collection', collapsed: true, members: ['Sampler'] });
  doc.groups[0].members[1] = 'Inner';
  const direct = inspectDiagram(doc, { groupId: 'Bank0' });
  assert.deepEqual(
    direct.modules.map((m) => m.id),
    ['TimerA'],
  );
  assert.deepEqual(direct.groups[0].members, ['TimerA', 'Inner']);
  const nested = inspectDiagram(doc, { groupId: 'Bank0', recursive: true });
  assert.deepEqual(
    nested.branches.map((e) => e.relation),
    ['internal', 'outgoing'],
  );
  assert.deepEqual(nested.branches[0].toPath, ['Bank0', 'Inner']);
  assert.deepEqual(nested.branches[1].fromPath, ['Bank0']);
  assert.deepEqual(nested.branches[1].toPath, []);
  assert.equal(nested.branches[1].crossGroup, true);
  assert.equal(nested.branches[1].net.constraint, true);
  assert.equal(nested.branches[1].branch.constraint, false);
  const module = inspectDiagram(doc, { moduleId: 'Sampler' });
  assert.deepEqual(module.path, ['Bank0', 'Inner']);
  assert.equal(module.branches[0].relation, 'incoming');
  module.modules[0].ports[0].id = 'Other';
  assert.equal(doc.modules[1].ports[0].id, 'in');
  assert.throws(() => inspectDiagram(doc, { groupId: 'Missing' }), /Missing/);
});

test('remove one destination, preserve shared and surviving metadata, then remove the final Net', () => {
  const doc = example(),
    before = structuredClone(doc);
  const result = applyDiagramOps(doc, [remove]);
  assert.deepEqual(result.document.connections, [{ ...doc.connections[0], to: [doc.connections[0].to[1]] }]);
  assert.deepEqual(result.diff, [
    { from: 'TimerA.out', path: '/connections/0/to', index: 0, removed: ['Sampler.in'], added: [] },
  ]);
  const last = applyDiagramOps(result.document, [{ ...remove, to: 'Monitor.in' }]);
  assert.deepEqual(last.document.connections, []);
  result.diff[0].removed.push('Other');
  assert.deepEqual(doc, before);
});

test('a batch updates membership, deep-merges style, replaces ports and connects new components', () => {
  const doc = example();
  doc.modules[0].style = { label: { color: '#112233', fontSize: 13 } };
  doc.groups.push({ id: 'NewBank', members: [] });
  const ops = [
    { op: 'addModule', module: { id: 'Extra' } },
    { op: 'updateModule', id: 'Extra', patch: { ports: [{ id: 'in', direction: 'input' }] } },
    { op: 'updateModule', id: 'TimerA', patch: { style: { label: { fontSize: 15 } } } },
    { op: 'setGroupMembers', id: 'NewBank', members: ['Sampler', 'Extra'] },
    { op: 'setGroupMembers', id: 'Bank0', members: ['TimerA'] },
    { op: 'addBranch', from: 'TimerA.out', to: 'Extra.in', branch: { constraint: false } },
  ];
  const { document: out } = applyDiagramOps(doc, ops);
  assert.deepEqual(out.modules[0].style.label, { color: '#112233', fontSize: 15 });
  assert.deepEqual(out.connections[0].to, [
    ...doc.connections[0].to,
    { endpoint: 'Extra.in', constraint: false },
  ]);
  assert.deepEqual(out.groups[1].members, ['Sampler', 'Extra']);
  out.modules.at(-1).ports[0].id = 'changed';
  assert.equal(ops[1].patch.ports[0].id, 'in');
  assert.throws(
    () => applyDiagramOps(doc, [{ op: 'updateModule', id: 'TimerA', patch: { id: 'Other' } }]),
    /ops\[0\].*TimerA.*id/,
  );
});

test('module deletion removes branches, group membership and only the referenced Grid cell', () => {
  const doc = example();
  doc.groups[0].layout = { type: 'grid', cells: [['TimerA', 'Sampler']] };
  const result = applyDiagramOps(doc, [{ op: 'removeModule', id: 'Sampler' }]);
  assert.deepEqual(result.document.groups[0].layout.cells, [['TimerA', null]]);
  assert.deepEqual(result.document.groups[0].members, ['TimerA']);
  assert.deepEqual(result.document.connections, [{ ...doc.connections[0], to: [doc.connections[0].to[1]] }]);
  assert.deepEqual(applyDiagramOps(doc, [{ op: 'removeModule', id: 'TimerA' }]).document.connections, []);
});

test('terminal and boundary inout source faces resolve by endpoint instead of object identity', () => {
  const doc = example();
  doc.connections = [];
  doc.groups[0].type = 'boundary';
  doc.groups[0].ports = [{ id: 'io', direction: 'inout', side: 'left' }];
  doc.terminals = [{ id: 'Out', direction: 'output' }];
  const { document: out } = applyDiagramOps(doc, [
    { op: 'addBranch', from: 'Bank0.io', to: 'Sampler.in', net: { id: 'Inner' } },
    { op: 'addBranch', from: 'Bank0.io', to: 'Monitor.in', net: { id: 'Outer' } },
    { op: 'addBranch', from: 'Bank0.io', to: { terminal: 'Out' }, branch: { feedback: true } },
  ]);
  assert.deepEqual(
    out.connections.map((e) => [e.id, e.to]),
    [
      ['Inner', ['Sampler.in']],
      ['Outer', ['Monitor.in', { endpoint: { terminal: 'Out' }, feedback: true }]],
    ],
  );
  const view = inspectDiagram(out, { groupId: 'Bank0' });
  const shared = { op: 'updateNet', from: 'Bank0.io', patch: { label: 'Output' } };
  assert.throws(() => applyDiagramOps(out, [shared]), /Bank0.io.*Ambiguous/);
  const pair = { from: 'Bank0.io', to: { terminal: 'Out' } };
  const patched = applyDiagramOps(out, [
    { ...shared, ...pair },
    { op: 'updateBranch', ...pair, patch: { constraint: false } },
  ]).document.connections;
  assert.deepEqual(patched[0], out.connections[0]);
  assert.deepEqual(patched[1], {
    ...out.connections[1],
    label: 'Output',
    to: ['Monitor.in', { endpoint: { terminal: 'Out' }, feedback: true, constraint: false }],
  });
  assert.deepEqual(
    view.branches.map((b) => b.fromPath),
    [['Bank0'], ['Bank0'], ['Bank0']],
  );
  assert.deepEqual(
    view.branches.map((b) => b.crossGroup),
    [false, true, true],
  );
  assert.deepEqual(
    applyDiagramOps(out, [{ op: 'removeBranch', from: 'Bank0.io', to: { terminal: 'Out' } }]).document
      .connections[1].to,
    ['Monitor.in'],
  );
});

test('failed operations identify the selector, final validation checks the whole batch, no input mutation', () => {
  const doc = example(),
    before = structuredClone(doc);
  for (const [op, reason] of [
    [{ op: 'addBranch', from: 'TimerA.out', to: 'Monitor.in' }, /already exists/],
    [{ op: 'addBranch', from: 'TimerA.out', to: 'Other.in' }, /Other.in/],
    [{ op: 'removeModule', id: 'Missing' }, /Missing/],
    [{ op: 'setGroupMembers', id: 'Bank0', members: ['Lost'] }, /Lost/],
    [{ op: 'addModule', module: { id: 'Bank0' } }, /Bank0/],
  ]) {
    assert.throws(
      () => applyDiagramOps(doc, [remove, op]),
      (err) => /ops\[1\]/.test(err.message) && reason.test(err.message),
    );
  }
  assert.throws(
    () => applyDiagramOps(doc, [{ op: 'updateModule', id: 'TimerA', patch: { ports: [] } }]),
    /connections\[0\].*TimerA.out.*ops\[0\]/,
  );
  assert.deepEqual(doc, before);
  assert.deepEqual(applyDiagramOps(doc, []).diff, []);
});

test('adding then removing a terminal branch preserves an omitted connections field', () => {
  const doc = example();
  delete doc.connections;
  doc.terminals = [{ id: 'Input', direction: 'input' }];
  const branch = { from: { terminal: 'Input' }, to: 'Monitor.in' };
  const batch = applyDiagramOps(doc, [
    { op: 'addBranch', ...branch },
    { op: 'removeBranch', ...branch },
  ]);
  assert.deepEqual(batch.document, doc);
  assert.deepEqual(batch.diff, []);
});
