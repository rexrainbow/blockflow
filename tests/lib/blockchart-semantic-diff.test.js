import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyDiagramOps } from '../../src/lib/blockchart/edit.js';
import { semanticDiff } from '../../src/lib/blockchart/edit-semantic-diff.js';

const sample = () =>
  JSON.parse(readFileSync(new URL('../../examples/blockchart/agent-edit-fanout.json', import.meta.url)));
const semantic = (doc, ops) => applyDiagramOps(doc, ops, { diffFormat: 'semantic' });

test('rename preserves fanout metadata, order and all Grid references and supports subsequent edits', () => {
  const doc = sample();
  doc.layout = { type: 'grid', cells: [['Bank0', 'Monitor']] };
  doc.groups[0].layout = { type: 'grid', cells: [['TimerA', 'Sampler']] };
  const original = structuredClone(doc);
  const ops = [
    { op: 'renameModule', id: 'TimerA', newId: 'ClockSource' },
    { op: 'renameModule', id: 'Sampler', newId: 'Receiver' },
    { op: 'renameModule', id: 'Monitor', newId: 'Observer' },
  ];
  const result = semantic(doc, ops);
  assert.deepEqual(doc, original);
  assert.equal(result.diff.length, 3);
  assert.deepEqual(
    result.diff.map((r) => [r.change, r.id, r.newId]),
    [
      ['rename', 'TimerA', 'ClockSource'],
      ['rename', 'Sampler', 'Receiver'],
      ['rename', 'Monitor', 'Observer'],
    ],
  );
  assert.ok(result.diff[0].references.some((r) => r.path === '/connections/0/from'));
  assert.ok(result.diff[2].references.some((r) => r.path === '/connections/0/to/1/endpoint'));
  assert.deepEqual(result.document.connections[0], {
    ...doc.connections[0],
    from: 'ClockSource.out',
    to: ['Receiver.in', { ...doc.connections[0].to[1], endpoint: 'Observer.in' }],
  });
  assert.deepEqual(result.document.groups[0].members, ['ClockSource', 'Receiver']);
  assert.deepEqual(result.document.groups[0].layout.cells, [['ClockSource', 'Receiver']]);
  assert.deepEqual(result.document.layout.cells, [['Bank0', 'Observer']]);
  assert.deepEqual(
    result.document.modules,
    doc.modules.map((m, i) => ({ ...m, id: ops[i].newId })),
  );
  const changed = semantic(doc, [
    ...ops,
    { op: 'updateModule', id: 'ClockSource', patch: { label: 'Tick' } },
    { op: 'updateBranch', from: 'ClockSource.out', to: 'Observer.in', patch: { feedback: true } },
    { op: 'setGridCells', id: 'Bank0', cells: [['Receiver', 'ClockSource']] },
  ]);
  assert.deepEqual(
    changed.diff.slice(3).map((r) => r.kind),
    ['module', 'gridCell', 'gridCell', 'branch'],
  );
  assert.ok(applyDiagramOps(doc, ops).diff.every((r) => r.path));
});

test('rename failures name the operation and conflicting IDs without mutating input', () => {
  const doc = sample(),
    original = structuredClone(doc);
  for (const newId of ['Sampler', 'Bank0', 'bad-id']) {
    assert.throws(
      () => semantic(doc, [{ op: 'renameModule', id: 'TimerA', newId }]),
      (error) => error.message.includes('ops[0] renameModule TimerA') && error.message.includes(newId),
    );
  }
  assert.throws(
    () => semantic(doc, [{ op: 'renameModule', id: 'Missing', newId: 'New' }]),
    /ops\[0\] renameModule Missing/,
  );
  assert.deepEqual(doc, original);
  const renamed = semantic(doc, [
    { op: 'renameModule', id: 'TimerA', newId: 'Temporary' },
    { op: 'renameModule', id: 'Temporary', newId: 'Final' },
  ]);
  assert.equal(renamed.diff.length, 1);
  assert.equal(renamed.diff[0].newId, 'Final');
});

test('retained object fields and ports are matched by ID even when their neighbors change', () => {
  const before = sample();
  before.groups.unshift({ id: 'OldGroup', members: [] });
  const after = structuredClone(before);
  after.groups.shift();
  after.groups.push({ id: 'NewGroup', members: [] });
  after.groups[0].label = 'Processing';
  const ports = after.modules[0].ports;
  ports.unshift({ id: 'extra', direction: 'input' });
  ports[1].label = 'Output';
  after.modules[0].label = 'Timer';
  assert.deepEqual(semanticDiff(before, after), [
    { kind: 'module', id: 'TimerA', change: 'updated', fields: [{ path: '/label', after: 'Timer' }] },
    { kind: 'port', owner: 'TimerA', id: 'extra', change: 'added', after: ports[0] },
    {
      kind: 'port',
      owner: 'TimerA',
      id: 'out',
      change: 'updated',
      fields: [{ path: '/label', after: 'Output' }],
    },
    { kind: 'group', id: 'OldGroup', change: 'removed', before: before.groups[0] },
    { kind: 'group', id: 'Bank0', change: 'updated', fields: [{ path: '/label', after: 'Processing' }] },
    { kind: 'group', id: 'NewGroup', change: 'added', after: after.groups[1] },
  ]);
});

test('replacement at a different array index reports IDs, membership and the single Grid cell', () => {
  const doc = sample();
  doc.groups[0].layout = { type: 'grid', cells: [['TimerA', 'Sampler']] };
  const ops = [
    { op: 'removeModule', id: 'TimerA' },
    { op: 'addModule', module: { ...doc.modules[0], id: 'TimerBitPeriod' } },
    { op: 'setGroupMembers', id: 'Bank0', members: ['TimerBitPeriod', 'Sampler'] },
    { op: 'setGridCells', id: 'Bank0', cells: [['TimerBitPeriod', 'Sampler']] },
  ];
  const { document, diff } = semantic(doc, ops);
  const pointer = applyDiagramOps(doc, ops);
  assert.deepEqual(document, pointer.document);
  assert.deepEqual(pointer, applyDiagramOps(doc, ops, { diffFormat: 'pointer' }));
  assert.deepEqual(diff, [
    { kind: 'module', id: 'TimerA', change: 'removed', before: doc.modules[0] },
    { kind: 'module', id: 'TimerBitPeriod', change: 'added', after: ops[1].module },
    { kind: 'members', groupId: 'Bank0', removed: ['TimerA'], added: ['TimerBitPeriod'] },
    { kind: 'gridCell', groupId: 'Bank0', row: 0, column: 0, before: 'TimerA', after: 'TimerBitPeriod' },
    { kind: 'net', id: 'Clock', change: 'removed', before: doc.connections[0] },
  ]);
  diff[1].after.ports[0].id = 'modified';
  assert.equal(document.modules.at(-1).ports[0].id, 'out');
  assert.equal(ops[1].module.ports[0].id, 'out');
});

test('one record each for the final shared label and changed branch style, including compact destinations', () => {
  const doc = sample(),
    net = { op: 'updateNet', id: 'Clock' };
  const change = { op: 'updateBranch', from: 'TimerA.out', to: 'Sampler.in' };
  const ops = [
    { ...net, patch: { label: 'intermediate' } },
    { ...net, patch: { label: 'Clock2' } },
    { ...change, patch: { style: { strokeWidth: 3 }, constraint: false } },
  ];
  assert.deepEqual(semantic(doc, ops).diff, [
    {
      kind: 'net',
      id: 'Clock',
      change: 'updated',
      fields: [{ path: '/label', before: 'Clock', after: 'Clock2' }],
    },
    {
      kind: 'branch',
      net: { id: 'Clock' },
      from: change.from,
      to: change.to,
      change: 'updated',
      fields: [
        { path: '/style', after: { strokeWidth: 3 } },
        { path: '/constraint', after: false },
      ],
    },
  ]);
  assert.deepEqual(semantic(doc, [ops[0], { ...net, patch: { label: 'Clock' } }]).diff, []);
  assert.throws(() => applyDiagramOps(doc, [], { diffFormat: 'unknown' }), /diffFormat/);
});

test('order records compare only retained module, port, group member, Net and branch identities', () => {
  const doc = sample();
  doc.modules[0].ports.push({ id: 'another', direction: 'output' });
  doc.modules.push({ id: 'Third', ports: [{ id: 'in', direction: 'input' }] });
  doc.connections.push({ from: 'TimerA.another', to: ['Third.in'] });
  const ops = [
    { op: 'removeModule', id: 'TimerA' },
    { op: 'addModule', module: { ...doc.modules[0], ports: [...doc.modules[0].ports].reverse() } },
    { op: 'setGroupMembers', id: 'Bank0', members: ['Sampler', 'TimerA'] },
    { op: 'addBranch', from: 'TimerA.another', to: 'Third.in' },
    {
      op: 'addBranch',
      from: 'TimerA.out',
      to: 'Monitor.in',
      branch: { constraint: false, feedback: false, style: { strokeWidth: 3 } },
      net: {
        id: 'Clock',
        label: 'Clock',
        feedback: true,
        constraint: true,
        style: { strokeColor: '#315585' },
      },
    },
    { op: 'addBranch', from: 'TimerA.out', to: 'Sampler.in' },
  ];
  const { diff } = semantic(doc, ops);
  assert.deepEqual(
    diff.map((r) => [r.kind, r.change]),
    [
      ['port', 'order'],
      ['module', 'order'],
      ['members', 'order'],
      ['branch', 'order'],
      ['net', 'order'],
    ],
  );
  const mixed = semantic(doc, [
    { op: 'addModule', module: { id: 'Added' } },
    { op: 'setGroupMembers', id: 'Bank0', members: ['Sampler', 'Added', 'TimerA'] },
  ]).diff;
  assert.deepEqual(mixed.at(-1), {
    kind: 'members',
    groupId: 'Bank0',
    change: 'order',
    before: ['TimerA', 'Sampler'],
    after: ['Sampler', 'TimerA'],
  });
});

test('anonymous inout Nets keep distinct identities even when their first branch changes', () => {
  const doc = sample();
  doc.groups[0].type = 'boundary';
  doc.groups[0].ports = [{ id: 'io', direction: 'inout', side: 'left' }];
  doc.terminals = [{ id: 'Out', direction: 'output' }];
  const from = 'Bank0.io',
    terminal = { terminal: 'Out' };
  doc.connections = [
    { from, to: ['Sampler.in'], label: 'internal' },
    { from, to: ['Monitor.in', terminal], label: 'external' },
  ];
  const out = semantic(doc, [
    { op: 'removeBranch', from, to: 'Monitor.in' },
    { op: 'updateNet', from, to: terminal, patch: { label: 'external 2' } },
    { op: 'updateBranch', from, to: terminal, patch: { feedback: true } },
  ]);
  assert.deepEqual(
    out.diff.map((r) => [r.kind, r.change, r.from, r.to]),
    [
      ['net', 'updated', from, terminal],
      ['branch', 'removed', from, 'Monitor.in'],
      ['branch', 'updated', from, terminal],
    ],
  );
  assert.deepEqual(out.diff[0].fields, [{ path: '/label', before: 'external', after: 'external 2' }]);
});

test('absent slots, explicit nulls, and authoring-only changes stay distinguishable', () => {
  const doc = sample();
  doc.groups[0].layout = { type: 'grid', cells: [['TimerA']] };
  doc.layout = { type: 'grid', cells: [['Bank0', 'Monitor']] };
  const out = semantic(doc, [
    { op: 'setGridCells', id: 'Bank0', cells: [['TimerA', null]] },
    { op: 'removeModule', id: 'Monitor' },
  ]);
  assert.deepEqual(
    out.diff.filter((r) => r.kind === 'gridCell'),
    [
      { kind: 'gridCell', groupId: 'Bank0', row: 0, column: 1, after: null },
      { kind: 'gridCell', groupId: null, row: 0, column: 1, before: 'Monitor', after: null },
    ],
  );
  const edge = { from: 'TimerA.out', to: 'Monitor.in' };
  doc.connections[0].to[1] = { endpoint: edge.to };
  const form = semantic(doc, [
    { op: 'removeBranch', ...edge },
    { op: 'addBranch', ...edge },
  ]);
  assert.equal(form.diff.length, 1);
  assert.equal(form.diff[0].change, 'representation');
});

test('moving receivers across boundary faces reports only membership for unchanged authored Nets', () => {
  const doc = sample();
  doc.groups[0].type = 'boundary';
  doc.groups[0].ports = [{ id: 'io', direction: 'inout', side: 'left' }];
  const from = 'Bank0.io';
  doc.connections = [
    { from, to: ['Sampler.in'], label: 'Sample' },
    { from, to: ['Monitor.in'], label: 'Monitor' },
  ];
  const ops = [{ op: 'setGroupMembers', id: 'Bank0', members: ['TimerA', 'Monitor'] }];
  for (const connections of [doc.connections, doc.connections.slice(0, 1)]) {
    assert.deepEqual(semantic({ ...doc, connections }, ops).diff, [
      { kind: 'members', groupId: 'Bank0', removed: ['Sampler'], added: ['Monitor'] },
    ]);
  }
});
