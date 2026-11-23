import { labelConflicts, segmentCrossesBox, segments } from './label-layout.js';
import { routeQuality } from './topology.js';
import { textSize } from '../shared/text.js';

const EPS = 1e-6;
const inflate = (b, n) => ({ x: b.x - n, y: b.y - n, width: b.width + 2 * n, height: b.height + 2 * n });
const overlaps = (a, b) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

function clearLabel(layout, edge, box) {
  if (layout.states.some((s) => overlaps(inflate(box, 4), s))) return false;
  for (const other of layout.transitions) {
    if (other !== edge && other.labelBounds && overlaps(inflate(box, 4), other.labelBounds)) return false;
    const hits = segments(other).filter(([a, b]) =>
      segmentCrossesBox(a, b, box, other === edge ? 0 : 3 + other.style.strokeWidth / 2),
    );
    if (other === edge ? hits.length !== 1 : hits.length) return false;
  }
  return true;
}

// Slide text only on its current supporting line, never onto a different branch.
function staggerLabels(layout, axis) {
  const along = axis === 'x' ? 'y' : 'x',
    extent = along === 'y' ? 'height' : 'width';
  const labels = layout.transitions.filter((e) => e.labelBounds);
  for (let pass = 0; pass < 2; pass++) {
    for (const edge of labels) {
      if (clearLabel(layout, edge, edge.labelBounds)) continue;
      const box = edge.labelBounds,
        center = edge.labelPosition;
      const margin = Math.max(14, edge.style.fontSize, edge.arrow ? edge.style.strokeWidth * 3 + 3 : 0),
        half = box[extent] / 2;
      const candidates = [];
      for (const [a, b] of segments(edge)) {
        if (
          Math.abs(a[axis] - b[axis]) > EPS ||
          Math.abs(a[axis] - center[axis]) > EPS ||
          !segmentCrossesBox(a, b, box)
        )
          continue;
        const lo = Math.min(a[along], b[along]) + half + margin;
        const hi = Math.max(a[along], b[along]) - half - margin;
        const positions = [center[along], (lo + hi) / 2, lo, hi];
        // Candidate bands account for unequal and multiline text, not fixed rows.
        for (const other of labels)
          if (other !== edge) {
            const r = other.labelBounds;
            positions.push(r[along] - half - 8, r[along] + r[extent] + half + 8);
          }
        for (const p of [...new Set(positions)]
          .filter((p) => p >= lo && p <= hi)
          .sort((a, b) => Math.abs(a - center[along]) - Math.abs(b - center[along]) || a - b)) {
          const delta = p - center[along];
          candidates.push({ ...box, [along]: box[along] + delta });
        }
      }
      const next = candidates.find((b) => clearLabel(layout, edge, b));
      if (next) {
        center[along] += next[along] - box[along];
        edge.labelBounds = next;
      }
    }
  }
  return labels.every((e) => clearLabel(layout, e, e.labelBounds));
}

// A monotone coordinate transform preserves wire topology. Never shorten a state.
function squeeze(layout, axis, a, b, amount) {
  const result = structuredClone(layout);
  const map = (x) => (x <= a ? x + amount : x >= b ? x : b - ((b - x) * (b - a - amount)) / (b - a));
  for (const state of result.states) {
    const delta = map(state[axis]) - state[axis];
    state[axis] += delta;
    state.labelPosition[axis] += delta;
    state.labelBounds[axis] += delta;
  }
  for (const edge of result.transitions) {
    for (const section of edge.sections) for (const p of section.points) p[axis] = map(p[axis]);
    if (edge.labelBounds) {
      const delta = map(edge.labelPosition[axis]) - edge.labelPosition[axis];
      edge.labelPosition[axis] += delta;
      edge.labelBounds[axis] += delta;
    }
  }
  return result;
}

function gaps(layout, axis) {
  const extent = axis === 'x' ? 'width' : 'height';
  const keys = [
    ...layout.states.flatMap((s) => [s[axis], s[axis] + s[extent]]),
    ...layout.transitions.flatMap((e) => [
      ...e.sections.flatMap((s) => s.points.map((p) => p[axis])),
      ...(e.labelPosition ? [e.labelPosition[axis]] : []),
    ]),
  ];
  const sorted = [...new Set(keys)].sort((a, b) => a - b);
  const clearance = Math.max(12, ...layout.transitions.map((e) => e.style.strokeWidth * 2 + 4));
  return sorted
    .slice(1)
    .map((b, i) => [sorted[i], b, clearance])
    .filter(
      ([a, b]) =>
        b - a > clearance + 1 &&
        !layout.states.some((s) => a < s[axis] + s[extent] - EPS && b > s[axis] + EPS),
    );
}

function frame(layout, axis) {
  const extent = axis === 'x' ? 'width' : 'height';
  const boxes = [
    ...layout.states,
    ...layout.transitions.filter((e) => e.labelBounds).map((e) => e.labelBounds),
    ...layout.transitions.flatMap((e) =>
      e.sections.flatMap((s) =>
        s.points.map((p) => {
          const guard = Math.max(8, e.style.strokeWidth * 1.5);
          return { [axis]: p[axis] - guard, [extent]: 2 * guard };
        }),
      ),
    ),
  ];
  const lo = Math.min(...boxes.map((b) => b[axis])),
    hi = Math.max(...boxes.map((b) => b[axis] + b[extent]));
  const shift = 24 - lo;
  for (const state of layout.states) {
    state[axis] += shift;
    state.labelPosition[axis] += shift;
    state.labelBounds[axis] += shift;
  }
  for (const edge of layout.transitions) {
    for (const section of edge.sections) for (const p of section.points) p[axis] += shift;
    if (edge.labelBounds) {
      edge.labelBounds[axis] += shift;
      edge.labelPosition[axis] += shift;
    }
  }
  layout[extent] = hi - lo + 48;
  if (layout.caption) {
    const size = textSize(layout.caption.text, { fontSize: 11 });
    if (axis === 'y') {
      layout.caption.position.y = layout.height + size.height / 2;
      layout.height += size.height + 24;
    } else layout.width = Math.max(layout.width, size.width + 48);
  }
}

/** Internal, bounded compaction. Unsafe or non-improving trials retain the baseline. */
export function compactStatechartChannels(input, direction = 'down', nodeSpacing = 40) {
  if (!input.states.length || !input.transitions.some((e) => e.labelBounds)) return input;
  const axis = ['left', 'right'].includes(direction) ? 'y' : 'x';
  const extent = axis === 'x' ? 'width' : 'height';
  const original = routeQuality(input);
  const along = axis === 'x' ? 'y' : 'x',
    alongSize = axis === 'x' ? 'height' : 'width';
  const peers = input.states.flatMap((a, i) =>
    input.states.slice(i + 1).flatMap((b) => {
      if (a[along] >= b[along] + b[alongSize] || b[along] >= a[along] + a[alongSize]) return [];
      const [first, second] = a[axis] < b[axis] ? [a, b] : [b, a];
      return [
        {
          first: first.id,
          second: second.id,
          gap: Math.min(nodeSpacing, second[axis] - first[axis] - first[extent]),
        },
      ];
    }),
  );
  const stateSpacingSafe = (trial) => {
    const states = new Map(trial.states.map((s) => [s.id, s]));
    return peers.every(
      (p) =>
        states.get(p.second)[axis] - states.get(p.first)[axis] - states.get(p.first)[extent] >= p.gap - EPS,
    );
  };
  let current = input,
    accepted = false,
    budget = 96;
  for (let pass = 0; pass < 2 && budget > 0; pass++) {
    let progress = false;
    // Increasing coordinate order keeps later gap boundaries unchanged by a squeeze.
    for (const [a, b, clearance] of gaps(current, axis)) {
      if (budget <= 0) break;
      let lo = 0,
        hi = b - a - clearance,
        best;
      for (let round = 0; round < 8 && hi - lo >= 0.5 && budget-- > 0; round++) {
        const amount = round ? (lo + hi) / 2 : hi;
        const trial = squeeze(current, axis, a, b, amount);
        if (stateSpacingSafe(trial) && staggerLabels(trial, axis) && !labelConflicts(trial).length) {
          lo = amount;
          best = trial;
        } else hi = amount;
      }
      if (best && lo >= 1) {
        current = best;
        accepted = true;
        progress = true;
      }
    }
    if (!progress) break;
  }
  if (!accepted) return input;
  frame(current, axis);
  const after = routeQuality(current);
  if (
    labelConflicts(current).length ||
    current[extent] >= input[extent] - 1 ||
    current.width > input.width + EPS ||
    current.height > input.height + EPS ||
    after.overlaps > original.overlaps ||
    after.crossings > original.crossings ||
    after.overlapLength > original.overlapLength + EPS ||
    after.bends > original.bends ||
    after.length > original.length + EPS
  )
    return input;
  return current;
}
