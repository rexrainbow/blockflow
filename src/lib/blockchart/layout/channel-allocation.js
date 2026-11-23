// Layout-neutral channel allocation. Planners own corridors, margins and coordinates.
export const TRACK_GAP = 6;

/** Interval coloring is deterministic; one Net shares its union interval. */
export function allocateTracks(branches) {
  const nets = new Map();
  for (const branch of branches) {
    const key = branch.net;
    const entry = nets.get(key) ?? { key, lo: Infinity, hi: -Infinity, width: 0, branches: [] };
    entry.lo = Math.min(entry.lo, branch.lo);
    entry.hi = Math.max(entry.hi, branch.hi);
    entry.width = Math.max(entry.width, branch.width);
    entry.branches.push(branch.id);
    nets.set(key, entry);
  }
  const tracks = [];
  for (const entry of nets.values()) entry.branches.sort();
  for (const entry of [...nets.values()].sort(
    (a, b) => a.lo - b.lo || a.hi - b.hi || a.key.localeCompare(b.key, 'en'),
  )) {
    let track = tracks.find((t) => t.nets.every((n) => n.hi < entry.lo || entry.hi < n.lo));
    if (!track) tracks.push((track = { width: 0, nets: [] }));
    track.width = Math.max(track.width, entry.width);
    track.nets.push(entry);
  }
  return tracks;
}

/** Required width along the packing axis, including two caller-supplied margins.
 * Keep the addition order stable: this extraction does not change layout floats.
 * Empty/single-track eligibility remains a planner decision, not an allocator rule.
 */
export function requiredTrackSpace(tracks, margin = 0) {
  return (
    2 * margin +
    tracks.reduce((sum, track) => sum + track.width, 0) +
    TRACK_GAP * Math.max(0, tracks.length - 1)
  );
}
