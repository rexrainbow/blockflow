import { fail } from './model.js';
import { textSize } from '../shared/text.js';

const TRACK_HEIGHT = 36;
const textWidth = (value) => textSize(value.replace(/\s/g, ' ')).width;

/** Plan in author order. Growth is calculated before any endpoint y is positioned. */
export function layoutLinks(document, { from, to, left, right, top, laneHeight, pixelsPerTick, linkRoute }) {
  const edges = new Map();
  document.signals.forEach((s, signalIndex) =>
    s.changes.forEach(([t, , id], i) => {
      if (i && id && t >= from && t <= to) edges.set(id, { signalIndex, signalId: s.id, t });
    }),
  );
  const tracks = Array(document.signals.length ? Math.max(1, document.signals.length - 1) : 0).fill(0);
  const plans = [];
  for (const [index, link] of (document.links ?? []).entries()) {
    const a = edges.get(link.from),
      b = edges.get(link.to);
    if (!a || !b) continue;
    const distance = Math.abs(a.signalIndex - b.signalIndex);
    const gutter =
      a.signalIndex < b.signalIndex
        ? b.signalIndex - 1
        : Math.min(b.signalIndex, Math.max(0, document.signals.length - 2));
    const reason =
      linkRoute === 'rail'
        ? 'forced'
        : distance > 3
          ? 'distance'
          : tracks[gutter] >= 8
            ? 'tracks'
            : undefined;
    const route = linkRoute === 'local' || !reason ? 'local' : 'rail';
    const track = route === 'local' ? tracks[gutter]++ : undefined;
    if (track >= 32) fail('render.links', 'local gutter exceeds 32 tracks; use auto or rail');
    plans.push({ index, link, route, reason: route === 'rail' ? reason : undefined, gutter, track, a, b });
  }
  const required = tracks.map((count) => (count ? 16 + count * TRACK_HEIGHT : 0));
  const laneYs = [];
  document.signals.forEach((s, i) => {
    laneYs.push(
      i
        ? laneYs[i - 1] + laneHeight + Math.max(0, required[i - 1] - (laneHeight - 24))
        : top + laneHeight / 2,
    );
  });
  let laneAreaBottom = laneYs.length ? laneYs.at(-1) + laneHeight / 2 : top;
  if (laneYs.length === 1 && tracks[0])
    laneAreaBottom = Math.max(laneAreaBottom, laneYs[0] + 24 + required[0]);
  const gutters = required.map((height, index) => ({
    index,
    trackCount: tracks[index],
    top: (laneYs[index] ?? top) + 12,
    bottom: laneYs[index + 1] === undefined ? laneAreaBottom : laneYs[index + 1] - 12,
  }));
  const x = (t) => left + (t - from) * pixelsPerTick;
  let railCount = 0,
    footerRows = 0;
  const linkRoutes = plans.map((plan) => {
    const { link, route } = plan;
    const a = { ...plan.a, x: x(plan.a.t), y: laneYs[plan.a.signalIndex] },
      b = { ...plan.b, x: x(plan.b.t), y: laneYs[plan.b.signalIndex] };
    let points, y, labelX;
    const delayText =
      link.delay === undefined
        ? ''
        : `${link.delay} ${/^\d/.test(document.timescale) ? '\u00d7 ' : ''}${document.timescale}`;
    const labelText = [link.label, delayText].filter((s) => s !== undefined && s !== '').join(' \u00b7 ');
    const width = textWidth(labelText);
    if (route === 'local') {
      y = gutters[plan.gutter].top + 26 + plan.track * TRACK_HEIGHT;
      points = [
        { x: a.x, y: a.y },
        { x: a.x, y },
        { x: b.x, y },
        { x: b.x, y: b.y },
      ];
    } else {
      const rail = right + 16 + railCount++ * 10;
      const ay = a.y + 16,
        by = b.y + (b.y <= a.y ? 16 : -16);
      points = [
        { x: a.x, y: a.y },
        { x: a.x, y: ay },
        { x: rail, y: ay },
        { x: rail, y: by },
        { x: b.x, y: by },
        { x: b.x, y: b.y },
      ];
      // A fallback has no free local track. Its measurement gets its own footer row,
      // so dimension text never occupies a waveform or an already allocated gutter.
      if (link.delay !== undefined) y = laneAreaBottom + 26 + footerRows++ * TRACK_HEIGHT;
      else {
        y = (ay + by) / 2 + 8;
        labelX = rail + 3;
      }
    }
    const dimension =
      link.delay === undefined ? undefined : { x1: a.x, x2: b.x, y: y + 10, delay: link.delay };
    const label = labelText
      ? {
          text: labelText,
          width,
          x: labelX ?? (Math.abs(a.x - b.x) >= width + 8 ? (a.x + b.x - width) / 2 : Math.max(a.x, b.x) + 8),
          y: y - 8,
        }
      : undefined;
    return {
      index: plan.index,
      link,
      route,
      reason: plan.reason,
      gutter: route === 'local' ? plan.gutter : undefined,
      track: plan.track,
      from: a,
      to: b,
      points,
      label,
      dimension,
    };
  });
  // Labels have a dedicated row but short tick intervals cannot contain the text.
  // Move text past any route stroke or earlier label occupying its measured band.
  const placed = [];
  for (const route of linkRoutes) {
    const label = route.label;
    if (!label) continue;
    const low = label.y - 12,
      high = label.y + 4,
      obstacles = [];
    for (const other of linkRoutes)
      other.points.slice(1).forEach((p, i) => {
        const q = other.points[i];
        if (Math.max(p.y, q.y) >= low && Math.min(p.y, q.y) <= high)
          obstacles.push([Math.min(p.x, q.x) - 4, Math.max(p.x, q.x) + 4]);
      });
    for (const other of placed)
      if (other.y + 4 >= low && other.y - 12 <= high)
        obstacles.push([other.x - 4, other.x + other.width + 4]);
    obstacles.sort((a, b) => a[0] - b[0]);
    for (const [start, end] of obstacles)
      if (label.x <= end && label.x + label.width >= start) label.x = end + 8;
    placed.push(label);
  }
  return { laneYs, laneAreaBottom, linkRoutes, gutters, footerHeight: footerRows * TRACK_HEIGHT };
}
