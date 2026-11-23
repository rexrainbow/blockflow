import test from 'node:test';
import assert from 'node:assert/strict';
import { allocateTracks, requiredTrackSpace } from '../../src/lib/blockchart/layout/channel-allocation.js';

test('interval coloring shares Net fan-out, reuses disjoint ranges and respects stroke widths', () => {
  const branches = [
    { id: 'a1', net: 'A', lo: 0, hi: 2, width: 2 },
    { id: 'a2', net: 'A', lo: 0, hi: 3, width: 4 },
    { id: 'b', net: 'B', lo: 1, hi: 4, width: 12 },
    { id: 'c', net: 'C', lo: 5, hi: 6, width: 2 },
  ];
  const before = structuredClone(branches),
    tracks = allocateTracks(branches);
  assert.equal(tracks.length, 2);
  assert.deepEqual(
    tracks.find((t) => t.nets.some((n) => n.key === 'A')).nets.map((n) => n.key),
    ['A', 'C'],
  );
  assert.equal(tracks.find((t) => t.nets.some((n) => n.key === 'B')).width, 12);
  assert.deepEqual(branches, before);
  assert.deepEqual(allocateTracks([...branches].reverse()), tracks);
});

test('required space counts strokes, fixed inter-track gaps and both margins', () => {
  const tracks = [{ width: 1.25 }, { width: 2.5 }, { width: 4 }];
  const saved = structuredClone(tracks);
  assert.equal(requiredTrackSpace(tracks), 19.75);
  assert.equal(requiredTrackSpace(tracks, 3.125), 26);
  assert.deepEqual(tracks, saved);
});

test('empty and single-track measurements leave eligibility to the planner', () => {
  assert.deepEqual(allocateTracks([]), []);
  assert.equal(requiredTrackSpace([]), 0);
  assert.equal(requiredTrackSpace([], 5), 10);
  assert.equal(requiredTrackSpace([{ width: 3.5 }], 2), 7.5);
});

test('touching foreign intervals require distinct tracks, disjoint intervals reuse width', () => {
  const touching = allocateTracks([
    { id: 'a', net: 'A', lo: 0, hi: 1, width: 2 },
    { id: 'b', net: 'B', lo: 1, hi: 2, width: 4 },
  ]);
  assert.equal(touching.length, 2);
  assert.equal(requiredTrackSpace(touching), 12);
  const disjoint = allocateTracks([
    { id: 'a', net: 'A', lo: 0, hi: 1, width: 2 },
    { id: 'b', net: 'B', lo: 2, hi: 3, width: 4 },
  ]);
  assert.equal(disjoint.length, 1);
  assert.equal(requiredTrackSpace(disjoint), 4);
});

test('a fanout Net reserves its union span even across a gap between its branches', () => {
  const branches = [
    { id: 'a2', net: 'A', lo: 10, hi: 11, width: 8 },
    { id: 'b', net: 'B', lo: 4, hi: 5, width: 2 },
    { id: 'a1', net: 'A', lo: 0, hi: 1, width: 1 },
  ];
  const saved = structuredClone(branches),
    tracks = allocateTracks(branches);
  assert.equal(tracks.length, 2);
  const span = tracks.flatMap((t) => t.nets).find((n) => n.key === 'A');
  assert.deepEqual(span, { key: 'A', lo: 0, hi: 11, width: 8, branches: ['a1', 'a2'] });
  assert.equal(requiredTrackSpace(tracks, 5), 26);
  assert.deepEqual(branches, saved);
  assert.deepEqual(allocateTracks([...branches].reverse()), tracks);
});
