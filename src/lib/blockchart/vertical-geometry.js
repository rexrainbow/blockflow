// Screen-space geometry: text remains horizontal while ports follow the flow.
export function verticalModuleGeometry(module, textSize, unit, pitch = 24) {
  const type = module.appearance?.type ?? (module.type === 'concat' ? 'bar' : 'rectangle');
  const stroke = module.style.borderWidth,
    margin = 12 + Math.max(0, stroke - 1),
    bar = type === 'bar';
  const measure = (value, style) => {
    const size = textSize(value, style),
      padding = style.hidden ? 0 : style.padding;
    return { width: size.width + 2 * padding, height: size.height + 2 * padding };
  };
  const title = measure(module.label, module.style.label);
  const inputs = module.ports.filter((p) => p.direction === 'input'),
    outputs = module.ports.filter((p) => p.direction === 'output');
  const sizes = new Map(module.ports.map((p) => [p.id, measure(p.displayName, p.style)]));
  const inputHeight = Math.max(0, ...inputs.map((p) => sizes.get(p.id).height));
  const outputHeight = Math.max(0, ...outputs.map((p) => sizes.get(p.id).height));
  const columns = Array.from({ length: Math.max(inputs.length, outputs.length) }, (_, i) =>
    Math.max(pitch, ...[inputs[i], outputs[i]].filter(Boolean).map((p) => sizes.get(p.id).width + 12)),
  );
  const allHidden = module.style.label.hidden && module.ports.every((p) => p.style.hidden);
  const height = Math.max(
    bar && allHidden ? 12 + 2 * Math.max(0, stroke - 1) : 84,
    (module.height ?? 0) * unit.height,
    bar && allHidden
      ? 12 + 2 * Math.max(0, stroke - 1)
      : title.height + inputHeight + outputHeight + 4 * margin,
  );
  const ratio = type === 'trapezoid' ? module.appearance.rightHeightRatio : 1;
  const required = (ports) =>
    ports.reduce((sum, p) => sum + Math.max(pitch, sizes.get(p.id).width + 12), 0) + 2 * margin;
  const topFraction = 1 - (1 - ratio) * Math.min(1, (margin + inputHeight) / height);
  const width = Math.max(
    bar ? 0 : 140,
    (module.width ?? 0) * unit.width,
    title.width ? (title.width + 2 * margin) / ratio : 0,
    type === 'trapezoid'
      ? Math.max(required(inputs) / topFraction, required(outputs) / ratio)
      : columns.reduce((a, b) => a + b, 0) + 2 * margin,
  );
  const extra = type === 'stacked' ? module.appearance.layers * 6 : 0;
  const points = Object.create(null),
    labels = Object.create(null);
  const centers = (ports, start, span) => {
    const widths =
      type === 'trapezoid' ? ports.map((p) => Math.max(pitch, sizes.get(p.id).width + 12)) : columns;
    const free = span - 2 * margin - widths.reduce((a, b) => a + b, 0);
    let x = start + margin + free / (widths.length + 1);
    return widths.map((w) => {
      const center = x + w / 2;
      x += w + free / (widths.length + 1);
      return center;
    });
  };
  for (const [ports, input] of [
    [inputs, true],
    [outputs, false],
  ]) {
    const fraction = type === 'trapezoid' ? (input ? topFraction : ratio) : 1;
    const xs = centers(ports, (width * (1 - fraction)) / 2, width * fraction);
    for (const p of ports) {
      const x = bar && !input && outputs.length === 1 ? width / 2 : xs[p.order];
      const y = input ? 0 : height + extra;
      points[p.id] = { x, y };
      labels[p.id] = {
        x,
        y: input ? margin + sizes.get(p.id).height / 2 : height - margin - sizes.get(p.id).height / 2,
        anchor: 'middle',
      };
    }
  }
  const half = stroke / 2,
    shapes = [];
  if (type === 'trapezoid')
    shapes.push({
      kind: 'polygon',
      points: [
        { x: half, y: half },
        { x: width - half, y: half },
        { x: (width * (1 + ratio)) / 2 - half, y: height - half },
        { x: (width * (1 - ratio)) / 2 + half, y: height - half },
      ],
    });
  else
    for (let layer = type === 'stacked' ? module.appearance.layers : 0; layer >= 0; layer--)
      shapes.push({
        kind: 'rect',
        x: layer * 6 + half,
        y: layer * 6 + half,
        width: width - stroke,
        height: height - stroke,
      });
  const result = {
    width: width + extra,
    height: height + extra,
    titleX: width / 2,
    titleY: (height + inputHeight - outputHeight) / 2,
    portPoints: points,
    portLabels: labels,
    portInset: margin,
    rowCenters: centers(inputs, 0, width),
  };
  if (type !== 'rectangle') result.body = { type, shapes };
  if (
    ![
      result.width,
      result.height,
      result.titleX,
      result.titleY,
      ...Object.values(points).flatMap((p) => [p.x, p.y]),
    ].every(Number.isFinite)
  )
    throw new Error('Non-finite module dimensions: ' + module.id);
  return result;
}
