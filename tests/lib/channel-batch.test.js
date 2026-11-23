import test from 'node:test';
import assert from 'node:assert/strict';
import { routeChannelProposals, connectionTrial } from '../../src/lib/blockchart/layout/channel-batch.js';
const p = (x, y) => ({ x, y });
function fixture() {
  const A = { id: 'A', x: 0, y: 0, width: 10, height: 10 },
    B = { id: 'B', x: 100, y: 0, width: 10, height: 10 };
  const connections = ['one', 'two'].map((id, i) => ({
    id,
    netId: id,
    style: { strokeWidth: 1 },
    sections: [{ points: [p(10, 20 + i * 20), p(95, 20 + i * 20), p(95, 30 + i * 20), p(100, 30 + i * 20)] }],
    routingInfo: { method: 'baseline' },
  }));
  const result = { modules: [A, B], groups: [], connections, _plans: { nodes: [A, B] } };
  const route = ({ branch, assignment }) => ({
    sections: [
      {
        points: [
          p(10, branch.lo),
          p(assignment.coordinate, branch.lo),
          p(assignment.coordinate, branch.hi),
          p(100, branch.hi),
        ],
      },
    ],
    routingInfo: {
      method: 'test-channel',
      channelStatus: 'routed',
      channelTrack: assignment.track,
      channelTrackCount: assignment.count,
    },
  });
  const proposal = {
    key: 'test',
    kind: 'grid',
    owner: '',
    axis: 'x',
    before: [A],
    after: [B],
    margin: 12,
    min: 22,
    max: 88,
    branches: [
      { id: 'one', net: 'one', lo: 20, hi: 30, width: 1 },
      { id: 'two', net: 'two', lo: 40, hi: 50, width: 1 },
    ],
    route,
  };
  return { result, model: { groups: [] }, proposal };
}
test('route-only drafts retain geometry and live plan identities', () => {
  const f = fixture(),
    trial = connectionTrial(f.result, new Set(['one']));
  assert.equal(trial.modules, f.result.modules);
  assert.equal(trial._plans, f.result._plans);
  assert.equal(trial._plans.nodes[0], f.result.modules[0]);
  assert.notEqual(trial.connections[0], f.result.connections[0]);
  assert.equal(trial.connections[1], f.result.connections[1]);
});
test('all branches commit together and preserve public edge identity', () => {
  const f = fixture(),
    edge = f.result.connections[0],
    geo = structuredClone(f.result.modules);
  const report = routeChannelProposals(f.result, f.model, [f.proposal]);
  assert.equal(report.committed, 1);
  assert.equal(f.result.connections[0], edge);
  assert.deepEqual(f.result.modules, geo);
  assert.ok(f.result.connections.every((e) => e.routingInfo.method === 'test-channel'));
  assert.ok(f.result.connections.every((e) => e.routingInfo.channelPlanners.includes('grid')));
});
for (const failure of ['null', 'throw', 'policy'])
  test(`a ${failure} failure preserves every branch and its diagnostics`, () => {
    const f = fixture(),
      before = structuredClone(f.result),
      original = f.proposal.route;
    if (failure === 'policy') f.proposal.accept = () => false;
    else
      f.proposal.route = (c) => {
        if (c.branch.id === 'two') {
          if (failure === 'throw') throw Error('no access');
          return null;
        }
        return original(c);
      };
    const report = routeChannelProposals(f.result, f.model, [f.proposal]);
    assert.equal(report.committed, 0);
    assert.deepEqual(f.result, before);
  });
test('duplicate offers neither route a branch twice nor allocate twice', () => {
  const f = fixture();
  let calls = 0;
  const original = f.proposal.route;
  f.proposal.route = (c) => {
    calls++;
    return original(c);
  };
  const other = { ...f.proposal, key: 'auto', kind: 'auto' };
  const report = routeChannelProposals(f.result, f.model, [other, f.proposal]);
  assert.equal(report.corridors, 1);
  assert.equal(report.committed, 1);
  assert.equal(calls, 2);
  assert.deepEqual(f.result.connections[0].routingInfo.channelPlanners, ['auto', 'grid']);
});
test('proposal, demand and connection ordering do not change frozen-geometry routes', () => {
  const a = fixture(),
    b = fixture();
  const other = (p) => ({ ...p, key: 'auto', kind: 'auto' });
  b.result.connections.reverse();
  b.proposal.branches.reverse();
  routeChannelProposals(a.result, a.model, [a.proposal, other(a.proposal)]);
  routeChannelProposals(b.result, b.model, [other(b.proposal), b.proposal]);
  assert.deepEqual(
    [...a.result.connections].sort((x, y) => x.id.localeCompare(y.id)),
    [...b.result.connections].sort((x, y) => x.id.localeCompare(y.id)),
  );
});
test('a multi-corridor branch cannot be partially overwritten by successive full-route adapters', () => {
  const f = fixture(),
    C = { id: 'C', x: 200, y: 0, width: 10, height: 10 };
  f.result.modules.push(C);
  const second = { ...f.proposal, key: 'next', before: [f.result.modules[1]], after: [C] };
  const before = structuredClone(f.result),
    report = routeChannelProposals(f.result, f.model, [f.proposal, second]);
  assert.equal(report.committed, 0);
  assert.deepEqual(f.result, before);
});
test('two conflicting corridor candidates roll back symmetrically, including their other branches', () => {
  const f = fixture(),
    C = { id: 'C', x: 200, y: 0, width: 10, height: 10 };
  f.result.modules.push(C);
  f.result.connections.push({
    id: 'three',
    netId: 'three',
    style: { strokeWidth: 1 },
    sections: [{ points: [p(210, 80), p(220, 80)] }],
    routingInfo: { method: 'baseline' },
  });
  const first = {
    ...f.proposal,
    route: ({ branch, trial }) =>
      branch.id === 'two'
        ? {
            sections: trial.connections.find((e) => e.id === 'two').sections,
            routingInfo: { method: 'candidate', channelStatus: 'routed' },
          }
        : {
            sections: [{ points: [p(10, 20), p(50, 20), p(50, 100), p(150, 100), p(150, 30), p(100, 30)] }],
            routingInfo: { method: 'candidate', channelStatus: 'routed' },
          },
  };
  const second = {
    ...f.proposal,
    key: 'second',
    before: [f.result.modules[1]],
    after: [C],
    branches: [{ id: 'three', net: 'three', lo: 80, hi: 120, width: 1 }],
    route: () => ({
      sections: [{ points: [p(210, 80), p(210, 100), p(50, 100), p(50, 120), p(220, 120), p(220, 80)] }],
      routingInfo: { method: 'candidate', channelStatus: 'routed' },
    }),
  };
  const before = structuredClone(f.result),
    report = routeChannelProposals(f.result, f.model, [second, first]);
  assert.equal(report.committed, 0);
  assert.deepEqual(f.result, before);
});
test('a failed corridor preserves its whole batch while an independent corridor commits', () => {
  const f = fixture(),
    C = { id: 'C', x: 200, y: 0, width: 10, height: 10 };
  f.result.modules.push(C);
  f.result.connections.push({
    id: 'three',
    netId: 'three',
    style: { strokeWidth: 1 },
    sections: [{ points: [p(210, 80), p(220, 80)] }],
    routingInfo: { method: 'baseline' },
  });
  const original = structuredClone(f.result.connections.slice(0, 2)),
    build = f.proposal.route;
  f.proposal.route = (c) => (c.branch.id === 'two' ? null : build(c));
  const second = {
    ...f.proposal,
    key: 'second',
    before: [f.result.modules[1]],
    after: [C],
    branches: [{ id: 'three', net: 'three', lo: 80, hi: 90, width: 1 }],
    route: () => ({
      sections: [{ points: [p(210, 80), p(215, 80), p(215, 90), p(220, 90), p(220, 80)] }],
      routingInfo: { method: 'candidate', channelStatus: 'routed' },
    }),
  };
  const report = routeChannelProposals(f.result, f.model, [f.proposal, second]);
  assert.equal(report.committed, 1);
  assert.deepEqual(f.result.connections.slice(0, 2), original);
  assert.equal(f.result.connections[2].routingInfo.method, 'candidate');
});
for (const failure of ['diagonal', 'endpoint', 'nonfinite'])
  test(`batch validation rejects an ${failure} route without partial publication`, () => {
    const f = fixture(),
      before = structuredClone(f.result),
      build = f.proposal.route;
    f.proposal.route = (c) => {
      const patch = build(c);
      if (c.branch.id === 'two') {
        if (failure === 'diagonal') patch.sections[0].points[1].y += 3;
        if (failure === 'endpoint') patch.sections[0].points[0].x += 2;
        if (failure === 'nonfinite') patch.sections[0].points[1].x = Infinity;
      }
      return patch;
    };
    assert.equal(routeChannelProposals(f.result, f.model, [f.proposal]).committed, 0);
    assert.deepEqual(f.result, before);
  });
