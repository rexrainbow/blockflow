// Trusted geometry profiles. Input JSON contains parameters, never drawing code.
const rectangle = (base) => base;
function bar(base, context) {
  const half = context.stroke / 2;
  const portPoints = Object.fromEntries(
    [...context.inputs, ...context.outputs].map((port) => [
      port.id,
      {
        x: port.direction === 'input' ? 0 : base.width,
        y:
          port.direction === 'input' || context.outputs.length > 1
            ? base.rowCenters[port.order]
            : (base.rowCenters[0] + base.rowCenters.at(-1)) / 2,
      },
    ]),
  );
  return {
    ...base,
    portPoints,
    body: {
      type: 'bar',
      shapes: [
        {
          kind: 'rect',
          x: half,
          y: half,
          width: base.width - context.stroke,
          height: base.height - context.stroke,
        },
      ],
    },
  };
}
function stacked(base, context, options) {
  const layers = options.layers,
    offset = 6,
    extra = layers * offset,
    half = context.stroke / 2;
  const shapes = [];
  for (let layer = layers; layer >= 0; layer--)
    shapes.push({
      kind: 'rect',
      x: layer * offset + half,
      y: layer * offset + half,
      width: base.width - context.stroke,
      height: base.height - context.stroke,
    });
  return {
    ...base,
    width: base.width + extra,
    height: base.height + extra,
    titleX: base.width / 2,
    outputLabelInset: base.portInset + extra,
    body: { type: 'stacked', shapes },
  };
}
function trapezoid(base, context, options) {
  const ratio = options.rightHeightRatio,
    margin = 12 + context.border;
  const width = Math.max(
    base.width,
    context.titleWidth +
      2 * Math.max(0, ...context.inputs.map((p) => p.width), ...context.outputs.map((p) => p.width)) +
      48 +
      2 * context.border,
  );
  const required = (ports) =>
    ports.reduce((sum, p) => sum + p.height, 0) + 12 * (ports.length + 1) + 2 * margin;
  // At the inner end of an input label, the sloping edges leave less vertical
  // space than at the left border. Reserve that safe span for the entire column.
  const inputWidth = Math.max(0, ...context.inputs.map((p) => p.width));
  const inputFraction = inputWidth ? Math.min(1, (base.portInset + inputWidth) / width) : 0;
  const inputSpan = 1 - (1 - ratio) * inputFraction;
  const height = Math.max(
    base.height,
    (context.titleHeight + 2 * margin) / ratio,
    required(context.inputs) / inputSpan,
    required(context.outputs) / ratio,
  );
  const inset = (height * (1 - ratio)) / 2,
    points = Object.create(null);
  for (const [ports, start, extent, x] of [
    [context.inputs, inset * inputFraction, height * inputSpan, 0],
    [context.outputs, inset, height * ratio, width],
  ]) {
    const total = ports.reduce((sum, p) => sum + p.height, 0),
      gap = (extent - 2 * margin - total) / (ports.length + 1);
    let y = start + margin + gap;
    for (const port of ports) {
      points[port.id] = { x, y: y + port.height / 2 };
      y += port.height + gap;
    }
  }
  const half = context.stroke / 2;
  return {
    ...base,
    width,
    height,
    titleX: width / 2,
    titleY: height / 2,
    portPoints: points,
    body: {
      type: 'trapezoid',
      shapes: [
        {
          kind: 'polygon',
          points: [
            { x: half, y: half },
            { x: width - half, y: inset + half },
            { x: width - half, y: height - inset - half },
            { x: half, y: height - half },
          ],
        },
      ],
    },
  };
}

export const APPEARANCES = Object.freeze({
  rectangle: { keys: ['type'], defaults: {}, geometry: rectangle },
  bar: { keys: ['type'], defaults: {}, geometry: bar },
  stacked: { keys: ['type', 'layers'], defaults: { layers: 2 }, geometry: stacked },
  trapezoid: { keys: ['type', 'rightHeightRatio'], defaults: { rightHeightRatio: 0.6 }, geometry: trapezoid },
});

export function parseAppearance(value, path, fail) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    fail('Expected an appearance object', path);
  if (!Object.hasOwn(APPEARANCES, value.type))
    fail('Expected rectangle, bar, stacked or trapezoid appearance', `${path}.type`);
  const definition = APPEARANCES[value.type];
  for (const key of Object.keys(value))
    if (!definition.keys.includes(key)) fail('Unsupported appearance property: ' + key, `${path}.${key}`);
  const result = { ...definition.defaults, ...value };
  if (
    value.type === 'stacked' &&
    (!Number.isInteger(result.layers) || result.layers < 1 || result.layers > 3)
  )
    fail('Stack layers must be an integer from 1 to 3', `${path}.layers`);
  if (
    value.type === 'trapezoid' &&
    (typeof result.rightHeightRatio !== 'number' ||
      !Number.isFinite(result.rightHeightRatio) ||
      result.rightHeightRatio < 0.2 ||
      result.rightHeightRatio > 1)
  )
    fail('Right height ratio must be between 0.2 and 1', `${path}.rightHeightRatio`);
  return result;
}

export function appearanceGeometry(appearance, base, context) {
  const options = appearance ?? { type: 'rectangle' };
  const result = APPEARANCES[options.type].geometry(base, context, options);
  if (!result.portPoints)
    result.portPoints = Object.fromEntries(
      [...context.inputs, ...context.outputs].map((port) => [
        port.id,
        { x: port.direction === 'input' ? 0 : result.width, y: base.rowCenters[port.order] },
      ]),
    );
  return result;
}
