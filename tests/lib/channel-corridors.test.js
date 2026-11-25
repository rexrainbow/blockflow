import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectCorridors,
  corridorAssignments,
  trackProposals,
} from '../../src/lib/blockchart/layout/channel-corridors.js';
function fixture() {
  const a = { id: 'A', x: 0, y: 0, width: 40, height: 30 },
    b = { id: 'B', x: 120, y: 0, width: 40, height: 30 };
  return { result: { modules: [a, b], groups: [] }, model: { groups: [] }, a, b };
}
function proposal(kind, f, branches = [{ id: 'w', net: 'N', lo: 0, hi: 30, width: 2 }]) {
  return {
    key: kind,
    kind,
    owner: '',
    axis: 'x',
    before: [f.a],
    after: [f.b],
    margin: 12,
    min: 52,
    max: 108,
    branches,
  };
}
test('same physical corridor deduplicates planner offers and budgets margin once', () => {
  const f = fixture(),
    ps = ['grid', 'auto', 'group'].map((k) => proposal(k, f));
  const [c] = collectCorridors(f.result, f.model, ps);
  assert.equal(collectCorridors(f.result, f.model, ps).length, 1);
  assert.equal(c.demands.length, 1);
  assert.equal(c.demands[0].offers.length, 3);
  assert.equal(c.tracks.length, 1);
  assert.equal(c.required, 2);
  assert.equal(c.min, 52);
  assert.equal(c.max, 108);
  assert.equal(corridorAssignments(c).size, 1);
  const summary = (items) => items.map((c) => ({ id: c.id, min: c.min, max: c.max, tracks: c.tracks }));
  assert.deepEqual(summary(collectCorridors(f.result, f.model, [...ps].reverse())), summary([c]));
});
test('fanout unions semantic Net spans and conservatively combines duplicate widths', () => {
  const f = fixture();
  const ps = [
    proposal('grid', f, [
      { id: 'w1', net: 'N', lo: 0, hi: 10, width: 1 },
      { id: 'w2', net: 'N', lo: 20, hi: 30, width: 2 },
    ]),
    proposal('group', f, [
      { id: 'w1', net: 'N', lo: -3, hi: 12, width: 14 },
      { id: 'other', net: 'Other', lo: 14, hi: 16, width: 2 },
    ]),
  ];
  const [c] = collectCorridors(f.result, f.model, ps),
    n = c.tracks.flatMap((t) => t.nets).find((n) => n.key === 'N');
  assert.equal(c.demands.length, 3);
  assert.equal(n.lo, -3);
  assert.equal(n.hi, 30);
  assert.equal(n.width, 14);
  assert.equal(c.tracks.length, 2);
  assert.equal(c.required, 22);
  assert.equal(c.min, 52);
});
test('identities use structural bands, not coordinates or discovery order', () => {
  const f = fixture(),
    ps = [proposal('grid', f), proposal('auto', f)];
  const original = collectCorridors(f.result, f.model, ps)[0].id;
  for (const n of f.result.modules) {
    n.x += 800;
    n.y -= 200;
  }
  assert.equal(collectCorridors(f.result, f.model, ps)[0].id, original);
  f.result.modules.reverse();
  assert.equal(collectCorridors(f.result, f.model, ps)[0].id, original);
});
test('different parents, axes and nonadjacent spaces never collapse by proximity', () => {
  const f = fixture();
  const third = { id: 'C', x: 240, y: 0, width: 40, height: 30 };
  f.result.modules.push(third);
  const p = proposal('grid', f),
    q = { ...proposal('auto', f), owner: 'Other' },
    r = { ...proposal('group', f), axis: 'y' },
    s = { ...proposal('grid', f), key: 'skip', after: [third] };
  assert.equal(collectCorridors(f.result, f.model, [p, q, r, s]).length, 4);
});
test('expanded children and a whole-Container description identify the same adjacent space', () => {
  const f = fixture(),
    left = { id: 'Left', members: ['A'], x: -10, y: -10, width: 60, height: 50 },
    right = { id: 'Right', members: ['B'], x: 110, y: -10, width: 60, height: 50 };
  f.result.groups = [left, right];
  const p = proposal('grid', f),
    q = { ...proposal('group', f), before: [left], after: [right] };
  const c = collectCorridors(f.result, f.model, [q, p]);
  assert.equal(c.length, 1);
  assert.equal(c[0].min, 62);
  assert.equal(c[0].max, 98);
});
test('synthetic source wrappers do not leak into corridor identity', () => {
  const f = fixture(),
    wrapper = { id: '_wrapper', members: ['A'], x: 0, y: 0, width: 40, height: 30 };
  f.result.groups = [wrapper];
  f.model.groups = [{ id: '_wrapper', _signalWrapper: true }];
  const ps = [proposal('grid', f), { ...proposal('auto', f), before: [wrapper] }];
  const [c] = collectCorridors(f.result, f.model, ps);
  assert.equal(c.demands.length, 1);
  assert.ok(!c.id.includes('_wrapper'));
});
test('one branch in two distinct corridors retains two demands instead of silently losing one', () => {
  const f = fixture(),
    next = { id: 'C', x: 240, y: 0, width: 40, height: 30 };
  f.result.modules.push(next);
  const a = proposal('grid', f),
    b = { ...proposal('grid', f), key: 'next', before: [f.b], after: [next] };
  const cs = collectCorridors(f.result, f.model, [a, b]);
  assert.equal(cs.length, 2);
  assert.ok(cs.every((c) => c.demands[0].id === 'w'));
});
test('Grid physical interval conversion follows live moved envelopes', () => {
  const f = fixture();
  f.result._gridChannels = [
    {
      kind: 'grid',
      owner: '',
      index: 0,
      axis: 'x',
      nodes: [f.a],
      targets: [f.b],
      margin: 12,
      inset: 0,
      gap: 80,
      branches: [{ id: 'w', net: 'N', lo: 0, hi: 1, width: 2, sourceNode: f.a, targetNode: f.b }],
    },
  ];
  f.b.y = 150;
  const [p] = trackProposals(f.result, 'grid');
  assert.equal(p.branches[0].lo, 0);
  assert.equal(p.branches[0].hi, 180);
  const saved = structuredClone(f.result);
  collectCorridors(f.result, f.model, [p]);
  assert.deepEqual(f.result, saved);
});
test('insufficient physical space does not return partial assignments', () => {
  const f = fixture();
  f.b.x = 55;
  const [c] = collectCorridors(f.result, f.model, [proposal('grid', f)]);
  assert.equal(c.fits, false);
  assert.equal(corridorAssignments(c).size, 0);
});

test('spread assignment divides spare physical width between tracks and both margins', () => {
  const tracks = [
    { width: 2, nets: [{ branches: ['A'] }] },
    { width: 4, nets: [{ branches: ['B'] }] },
  ];
  const c = {
    id: 'physical',
    axis: 'x',
    owner: 'Root',
    fits: true,
    min: 10,
    max: 110,
    available: 100,
    required: 12,
    tracks,
  };
  const a = corridorAssignments(c, false, { spread: true });
  const left = a.get('A').coordinate - 1 - c.min,
    right = c.max - a.get('B').coordinate - 2;
  const between = a.get('B').coordinate - a.get('A').coordinate - 3;
  assert.ok(Math.abs(left - right) < 1e-6);
  assert.ok(Math.abs(between - 6 - left) < 1e-6);
  const packed = corridorAssignments(c);
  assert.equal(packed.get('B').coordinate - packed.get('A').coordinate, 9);
});
