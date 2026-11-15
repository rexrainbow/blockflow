export const sideVector = (side) =>
  ({ left: { x: -1, y: 0 }, right: { x: 1, y: 0 }, top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 } })[side];
export const defaultSide = (p, flow) =>
  flow === 'down' ? (p.direction === 'input' ? 'top' : 'bottom') : p.direction === 'input' ? 'left' : 'right';
export const needsSides = (node, flow) =>
  node.ports.some((p) => p.direction === 'inout' || p.side !== defaultSide(p, flow));

export function sidedGeometry(node, flow, baseGeometry, textSize, unit, pitch = 24, corner = 12) {
  const counts = { input: 0, output: 0 },
    padding = 14 + node.style.borderWidth;
  const sizes = new Map(
    node.ports.map((p) => {
      const t = textSize(p.displayName, p.style),
        pad = p.style.hidden ? 0 : p.style.padding;
      return [p.id, { width: t.width + 2 * pad, height: t.height + 2 * pad }];
    }),
  );
  const ports = node.ports.map((p) => {
    const side = p.side ?? defaultSide(p, flow),
      direction = ['left', 'top'].includes(side) ? 'input' : 'output';
    return { ...p, direction, order: counts[direction]++ };
  });
  const sidePorts = (side) => node.ports.filter((p) => (p.side ?? defaultSide(p, flow)) === side);
  const extent = (side, axis) =>
    sidePorts(side).reduce((n, p) => n + Math.max(pitch, sizes.get(p.id)[axis] + 12), 0) + 2 * padding;
  const largest = (sides, axis) =>
    Math.max(0, ...node.ports.filter((p) => sides.includes(p.side)).map((p) => sizes.get(p.id)[axis]));
  const title = textSize(node.label, node.style.label),
    tp = node.style.label.hidden ? 0 : node.style.label.padding;
  const ratio = node.appearance?.type === 'trapezoid' ? node.appearance.rightHeightRatio : 1;
  const hidden = node.ports.every((p) => p.style.hidden),
    extra = node.appearance?.type === 'stacked' ? node.appearance.layers * 6 : 0,
    titleGeometry = hidden ? baseGeometry({ ...node, ports: [] }) : null;
  // Hidden labels need connection slots, but no text lanes or proxy port rows.
  const anchorExtent = (side) => {
    const count = sidePorts(side).length;
    return count ? count * pitch + 2 * (corner + Math.max(0, node.style.borderWidth - 1)) : 0;
  };
  const w = hidden
    ? Math.max(
        titleGeometry.width - extra,
        Math.max(anchorExtent('top'), anchorExtent('bottom')) / (flow === 'down' ? ratio : 1),
      )
    : Math.max(
        extent('top', 'width'),
        extent('bottom', 'width'),
        title.width + 2 * tp + 2 * largest(['left', 'right'], 'width') + 4 * padding,
      ) / (flow === 'down' ? ratio : 1);
  const h = hidden
    ? Math.max(
        titleGeometry.height - extra,
        Math.max(anchorExtent('left'), anchorExtent('right')) / (flow === 'down' ? 1 : ratio),
      )
    : Math.max(
        extent('left', 'height'),
        extent('right', 'height'),
        title.height + 2 * tp + 2 * largest(['top', 'bottom'], 'height') + 4 * padding,
      ) / (flow === 'down' ? 1 : ratio);
  const result = baseGeometry({
    ...node,
    ports: hidden ? [] : ports,
    width: Math.max(node.width ?? 0, w / unit.width),
    height: Math.max(node.height ?? 0, h / unit.height),
  });
  const W = result.width - extra,
    H = result.height - extra;
  result.titleX = W / 2;
  result.titleY = H / 2;
  result.portPoints = Object.create(null);
  result.portLabels = Object.create(null);
  const trap = node.appearance?.type === 'trapezoid';
  for (const side of ['left', 'right', 'top', 'bottom']) {
    const list = sidePorts(side),
      horizontal = ['top', 'bottom'].includes(side),
      axis = horizontal ? 'width' : 'height';
    const start = trap
      ? flow === 'down' && side === 'bottom'
        ? (W * (1 - ratio)) / 2
        : flow !== 'down' && side === 'right'
          ? (H * (1 - ratio)) / 2
          : 0
      : 0;
    const span = (horizontal ? W : H) - 2 * start,
      total = list.reduce((n, p) => n + Math.max(pitch, sizes.get(p.id)[axis] + 12), 0),
      gap = (span - total) / (list.length + 1);
    let cursor = start + gap;
    for (const p of list) {
      const s = sizes.get(p.id),
        size = Math.max(pitch, s[axis] + 12),
        along = cursor + size / 2;
      cursor += size + gap;
      let x = side === 'left' ? 0 : side === 'right' ? result.width : along,
        y = side === 'top' ? 0 : side === 'bottom' ? result.height : along;
      if (trap && flow === 'down' && !horizontal)
        x = side === 'left' ? ((W * (1 - ratio)) / 2) * (y / H) : W - ((W * (1 - ratio)) / 2) * (y / H);
      if (trap && flow !== 'down' && horizontal)
        y = side === 'top' ? ((H * (1 - ratio)) / 2) * (x / W) : H - ((H * (1 - ratio)) / 2) * (x / W);
      result.portPoints[p.id] = { x, y };
      const pad = p.style.hidden ? 0 : p.style.padding;
      result.portLabels[p.id] = horizontal
        ? {
            x,
            y: y + (side === 'top' ? 1 : -1) * (padding + s.height / 2) - (side === 'bottom' ? extra : 0),
            anchor: 'middle',
          }
        : {
            x: x + (side === 'left' ? 1 : -1) * (padding + pad) - (side === 'right' ? extra : 0),
            y,
            anchor: side === 'left' ? 'start' : 'end',
          };
    }
  }
  return result;
}
