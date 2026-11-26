import { parseWaveform, tick, fail, object } from './model.js';
import { escapeXml as escape } from '../shared/svg.js';
import { textSize } from '../shared/text.js';
import { layoutLinks } from './link-layout.js';

export function layoutWaveform(value, options = {}) {
  object(
    options,
    ['from', 'to', 'pixelsPerTick', 'laneHeight', 'labelWidth', 'tickStep', 'idPrefix', 'linkRoute'],
    'options',
  );
  if (
    options.idPrefix !== undefined &&
    (typeof options.idPrefix !== 'string' || !/^[A-Za-z_][\w.-]*$/.test(options.idPrefix))
  )
    fail('options.idPrefix', 'expected an identifier');
  const linkRoute = options.linkRoute ?? 'auto';
  if (!['auto', 'local', 'rail'].includes(linkRoute))
    fail('options.linkRoute', 'expected auto, local or rail');
  const document = parseWaveform(value),
    from = tick(options.from ?? 0, 'options.from'),
    to = tick(options.to ?? document.length, 'options.to');
  if (from >= to || to > document.length) fail('options.to', 'expected from < to <= length');
  const pixelsPerTick = options.pixelsPerTick ?? 24,
    laneHeight = options.laneHeight ?? 56,
    labelWidth = options.labelWidth ?? 160;
  for (const [key, v] of Object.entries({ pixelsPerTick, laneHeight, labelWidth }))
    if (!Number.isFinite(v) || v < 1) fail(`options.${key}`, 'expected a positive finite number');
  if (laneHeight < 40 || labelWidth < 40) fail('options', 'laneHeight and labelWidth must be at least 40');
  const tickStep = tick(options.tickStep ?? 1, 'options.tickStep', 1);
  const tickCount = Math.max(0, Math.floor(to / tickStep) - Math.ceil(from / tickStep) + 1);
  const bitCount = document.grid
    ? Math.max(
        0,
        Math.floor((to - document.grid.offset) / document.grid.ticksPerBit) -
          Math.max(0, Math.ceil((from - document.grid.offset) / document.grid.ticksPerBit)) +
          1,
      )
    : 0;
  const gridCount = tickCount + bitCount;
  if (
    gridCount > 10000 ||
    document.signals.length > 512 ||
    (document.links?.length ?? 0) > 512 ||
    (document.markers?.length ?? 0) > 2048
  )
    fail('render', 'display limit exceeded; use a shorter time window or larger tickStep');
  const left = labelWidth,
    top = 64,
    right = left + (to - from) * pixelsPerTick;
  const routing = layoutLinks(document, { from, to, left, right, top, laneHeight, pixelsPerTick, linkRoute });
  const markerWidth = Math.max(
    0,
    ...(document.markers ?? []).map((m) => textSize((m.label ?? '').replace(/\s/g, ' ')).width),
  );
  const width = Math.max(
      right + Math.max(32, markerWidth) + 16,
      24 + textSize(document.title).width,
      ...routing.linkRoutes.map((r) =>
        r.label ? r.label.x + r.label.width + 16 : Math.max(...r.points.map((p) => p.x)) + 16,
      ),
    ),
    baseHeight = routing.laneAreaBottom + routing.footerHeight + 32,
    plotBottom = baseHeight - 16;
  const x = (t) => left + (t - from) * pixelsPerTick;
  const lanes = document.signals.map((s, i) => {
    const y = routing.laneYs[i];
    const segments = s.changes.flatMap((c, j) => {
      const start = Math.max(from, c[0]),
        end = Math.min(to, s.changes[j + 1]?.[0] ?? document.length);
      return start < end ? [{ from: start, to: end, value: c[1], x1: x(start), x2: x(end) }] : [];
    });
    const edges = s.changes.flatMap((c, j) =>
      j && c[0] >= from && c[0] <= to ? [{ t: c[0], id: c[2], x: x(c[0]) }] : [],
    );
    return { ...s, y, segments, edges };
  });
  if (lanes.reduce((count, lane) => count + lane.segments.length + lane.edges.length, 0) > 50000)
    fail('render', 'visible change limit exceeded; use a smaller time window');
  // Sort visible labels by position, preserving author order for equal starts.
  // Each row stores its rightmost occupied pixel; neighbouring labels keep an 8px gap.
  const rowEnds = [];
  const markerLabels = (document.markers ?? [])
    .filter((m) => m.label !== undefined && (m.t ?? m.to) >= from && (m.t ?? m.from) <= to)
    .map((m) => ({
      id: m.id,
      x: x(Math.max(m.t ?? m.from, from)) + 3,
      width: textSize(m.label.replace(/\s/g, ' ')).width,
    }))
    .sort((a, b) => a.x - b.x)
    .map((label) => {
      let row = rowEnds.findIndex((end) => end + 8 <= label.x);
      if (row < 0) row = rowEnds.length;
      rowEnds[row] = label.x + label.width;
      return { ...label, row, y: baseHeight - 4 + row * 20 };
    });
  const height = baseHeight + Math.max(0, rowEnds.length - 1) * 20;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width > 1e7 || height > 1e7)
    fail('render', 'SVG dimensions exceed the display limit');
  return {
    document,
    from,
    to,
    pixelsPerTick,
    tickStep,
    left,
    top,
    right,
    width,
    height,
    laneHeight,
    lanes,
    plotBottom,
    markerLabels,
    linkRoutes: routing.linkRoutes,
    gutters: routing.gutters,
  };
}

/** Draw deterministic, selectable SVG from synchronous value changes. */
export function renderWaveformSvg(value, options = {}) {
  const l = layoutWaveform(value, options),
    prefix = escape(options.idPrefix ?? 'blockflow-waveform');
  const x = (t) => l.left + (t - l.from) * l.pixelsPerTick;
  const text = (value, x, y, attrs = '') =>
    `<text x="${x}" y="${y}" ${attrs}>${escape(String(value))}</text>`;
  const lines = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${l.width}" height="${l.height}" viewBox="0 0 ${l.width} ${l.height}" font-family="monospace" font-size="12">`,
    `<rect width="${l.width}" height="${l.height}" fill="#ffffff"/>`,
    `<defs><clipPath id="${prefix}-lane-labels"><rect width="${l.left - 8}" height="${l.height}"/></clipPath></defs>`,
    text(l.document.title, 12, 20, 'data-role="waveform-title"'),
    text(l.document.timescale, 12, 44),
  ];
  for (let t = Math.ceil(l.from / l.tickStep) * l.tickStep; t <= l.to; t += l.tickStep) {
    lines.push(
      `<path data-role="tick-grid" data-t="${t}" d="M ${x(t)} ${l.top - 8} V ${l.plotBottom}" stroke="#e3e8ef"/>`,
      text(t, x(t), l.top - 14, 'text-anchor="middle"'),
    );
  }
  if (l.document.grid) {
    const { ticksPerBit, offset } = l.document.grid;
    for (
      let i = Math.max(0, Math.ceil((l.from - offset) / ticksPerBit));
      offset + i * ticksPerBit <= l.to;
      i++
    ) {
      const t = offset + i * ticksPerBit;
      lines.push(
        `<path data-role="bit-grid" data-bit="${i}" data-t="${t}" d="M ${x(t)} 32 V ${l.plotBottom}" stroke="#8da0b8" stroke-dasharray="4 3"/>`,
        text(`bit ${i}`, x(t) + 3, 34),
      );
    }
  }
  l.lanes.forEach((s, si) => {
    const color = s.style?.color ?? '#2457a6';
    lines.push(
      `<g data-signal="${escape(s.id)}" data-role="waveform-lane"${s.port ? ` data-port="${escape(s.port)}"` : ''}>`,
      text(
        s.scope ? `${s.scope}/${s.label}` : s.label,
        12,
        s.y + 4,
        `data-role="signal-label" clip-path="url(#${prefix}-lane-labels)"`,
      ),
    );
    s.segments.forEach((segment, j) => {
      const { x1, x2, value, from, to } = segment,
        clip = `${prefix}-segment-${si}-${j}`;
      lines.push(
        `<g data-role="value-segment" data-signal="${escape(s.id)}" data-from="${from}" data-to="${to}">`,
      );
      if (s.width === 1 && (value === 0 || value === 1))
        lines.push(
          `<path d="M ${x1} ${s.y + (value ? -12 : 12)} H ${x2}" fill="none" stroke="${color}" stroke-width="2"/>`,
        );
      else {
        const diagonal = Math.min(6, (x2 - x1) / 3),
          fill = value === 'x' ? '#ffeded' : value === 'z' ? '#eef0ff' : '#eef5ff';
        lines.push(
          `<path d="M ${x1} ${s.y} L ${x1 + diagonal} ${s.y - 12} H ${x2 - diagonal} L ${x2} ${s.y} L ${x2 - diagonal} ${s.y + 12} H ${x1 + diagonal} Z" fill="${fill}" stroke="${color}"${value === 'z' ? ' stroke-dasharray="3 3"' : ''}/>`,
        );
        lines.push(
          `<defs><clipPath id="${clip}"><rect x="${x1}" y="${s.y - 12}" width="${x2 - x1}" height="24"/></clipPath></defs>`,
          text(
            value,
            (x1 + x2) / 2,
            s.y + 4,
            `text-anchor="middle" clip-path="url(#${clip})" data-role="segment-value"`,
          ),
        );
      }
      lines.push('</g>');
    });
    for (const e of s.edges) {
      lines.push(
        `<path data-edge="${escape(s.id + ':' + e.t)}"${e.id ? ` data-edge-id="${escape(e.id)}"` : ''} data-signal="${escape(s.id)}" data-t="${e.t}" d="M ${e.x} ${s.y - 12} V ${s.y + 12}" stroke="${color}" stroke-width="2"/>`,
      );
    }
    lines.push('</g>');
  });
  for (const route of l.linkRoutes) {
    const { link, points, label, dimension } = route;
    const b = points.at(-1),
      previous = points.at(-2),
      direction = b.y > previous.y ? 1 : -1;
    lines.push(
      `<g data-link="${escape(link.from + ' -> ' + link.to)}" data-from-edge="${escape(link.from)}" data-to-edge="${escape(link.to)}" data-route="${route.route}">`,
      `<path data-role="link-path" d="${points.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ')}" fill="none" stroke="#9b4d15"/>`,
      `<polygon data-role="link-arrow" points="${b.x},${b.y} ${b.x - 4},${b.y - direction * 7} ${b.x + 4},${b.y - direction * 7}" fill="#9b4d15"/>`,
    );
    if (dimension) {
      const { x1, x2, y, delay } = dimension,
        lo = Math.min(x1, x2),
        hi = Math.max(x1, x2),
        tip = Math.min(3, (hi - lo) / 3);
      lines.push(
        `<g data-role="delay-dimension" data-delay="${delay}" stroke="#9b4d15" stroke-width="0.7" fill="none">`,
        `<path d="M ${x1} ${y - 10} V ${y + 4} M ${x2} ${y - 10} V ${y + 4} M ${lo} ${y} H ${hi}"/>`,
      );
      if (tip)
        lines.push(
          `<path d="M ${lo + tip} ${y - 2} L ${lo} ${y} L ${lo + tip} ${y + 2} M ${hi - tip} ${y - 2} L ${hi} ${y} L ${hi - tip} ${y + 2}"/>`,
        );
      lines.push('</g>');
    }
    if (label) lines.push(text(label.text, label.x, label.y, 'data-role="link-label"'));
    lines.push('</g>');
  }
  const markerLabels = new Map(l.markerLabels.map((label) => [label.id, label]));
  for (const marker of l.document.markers ?? []) {
    const start = marker.t ?? marker.from,
      end = marker.t ?? marker.to;
    if (end < l.from || start > l.to) continue;
    lines.push(`<g data-marker="${escape(marker.id)}">`);
    if (marker.t !== undefined)
      lines.push(`<path d="M ${x(start)} 36 V ${l.plotBottom}" stroke="#be185d" stroke-dasharray="3 3"/>`);
    else
      lines.push(
        `<rect x="${x(Math.max(start, l.from))}" y="${l.top - 4}" width="${x(Math.min(end, l.to)) - x(Math.max(start, l.from))}" height="${l.plotBottom - l.top + 4}" fill="#fef08a" fill-opacity="0.2"/>`,
      );
    const label = markerLabels.get(marker.id);
    if (label) lines.push(text(marker.label, label.x, label.y, 'data-role="marker-label"'));
    lines.push('</g>');
  }
  lines.push('</svg>');
  return lines.join('\n');
}
