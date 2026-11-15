import { textSize, textBounds } from '../shared/text.js';
import { LAYOUT_DEFAULTS } from './layout-defaults.js';

/** A thin semantic bar inside an envelope that reserves external text separately. */
export function concatGeometry(module, direction) {
  const down = direction === 'down',
    stroke = module.style.borderWidth;
  const thickness = 12 + 2 * Math.max(0, stroke - 1),
    margin = 12;
  const inputs = module.ports.filter((p) => p.direction === 'input');
  const slots = module._receiverSlots?.[down ? 'top' : 'left'];
  const sizes = new Map(module.ports.map((p) => [p.id, textSize(p.displayName, p.style)]));
  const spans = inputs.map((p) =>
    Math.max(
      LAYOUT_DEFAULTS.portPitch,
      p.style.hidden ? 0 : 2 * (sizes.get(p.id)[down ? 'width' : 'height'] + p.style.padding + 6),
      slots?.find((s) => s.id === p.id)?.size ?? 0,
    ),
  );
  const length = Math.max(
    2 * thickness,
    spans.reduce((a, b) => a + b, 0) + 2 * margin,
    (down ? (module.width ?? 0) : (module.height ?? 0)) * (down ? 140 : 84),
  );
  const gap = (length - spans.reduce((a, b) => a + b, 0)) / (inputs.length + 1);
  let cursor = gap;
  const centers = spans.map((span) => {
    const center = cursor + span / 2;
    cursor += span + gap;
    return center;
  });
  const outputCenter = (centers[0] + centers.at(-1)) / 2;
  const bar = { x: 0, y: 0, width: down ? length : thickness, height: down ? thickness : length };
  const title = textSize(module.label, module.style.label);
  let titlePosition = down
    ? { x: length + 8 + module.style.label.padding + title.width / 2, y: thickness / 2, anchor: 'middle' }
    : { x: thickness / 2, y: -8 - module.style.label.padding - title.height / 2, anchor: 'middle' };
  const portPoints = {},
    portLabels = {};
  const boxes = [bar];
  for (const p of module.ports) {
    const input = p.direction === 'input',
      center = input ? centers[p.order] : outputCenter;
    const size = sizes.get(p.id),
      pad = p.style.padding;
    portPoints[p.id] = down
      ? { x: center, y: input ? 0 : thickness }
      : { x: input ? 0 : thickness, y: center };
    // Text stays beside the access line, never over its centerline.
    portLabels[p.id] = down
      ? {
          x: center + 6 + pad + size.width / 2,
          y: input ? -8 - pad - size.height / 2 : thickness + 8 + pad + size.height / 2,
          anchor: 'middle',
        }
      : {
          x: input ? -8 - pad : thickness + 8 + pad,
          y: center - 6 - pad - size.height / 2,
          anchor: input ? 'end' : 'start',
        };
    if (p.style.hidden) portLabels[p.id] = { ...portPoints[p.id], anchor: 'middle' };
    if (!p.style.hidden) boxes.push(textBounds(p.displayName, portLabels[p.id], p.style));
  }
  if (!module.style.label.hidden) {
    // Clear Port text too, including multiline titles and unequal Port names.
    titlePosition = down
      ? {
          x: Math.max(...boxes.map((b) => b.x + b.width)) + 8 + module.style.label.padding + title.width / 2,
          y: thickness / 2,
          anchor: 'middle',
        }
      : {
          x: thickness / 2,
          y: Math.min(...boxes.map((b) => b.y)) - 8 - module.style.label.padding - title.height / 2,
          anchor: 'middle',
        };
    boxes.push(textBounds(module.label, titlePosition, module.style.label));
  }
  const minX = Math.min(...boxes.map((b) => b.x)),
    minY = Math.min(...boxes.map((b) => b.y));
  const naturalWidth = Math.max(...boxes.map((b) => b.x + b.width)) - minX;
  const naturalHeight = Math.max(...boxes.map((b) => b.y + b.height)) - minY;
  const width = Math.max(naturalWidth, (module.width ?? 0) * 140);
  const height = Math.max(naturalHeight, (module.height ?? 0) * 84);
  const dx = -minX + (width - naturalWidth) / 2,
    dy = -minY + (height - naturalHeight) / 2;
  for (const p of [...Object.values(portPoints), ...Object.values(portLabels)]) {
    p.x += dx;
    p.y += dy;
  }
  return {
    width,
    height,
    titleX: titlePosition.x + dx,
    titleY: titlePosition.y + dy,
    portInset: 0,
    portPoints,
    portLabels,
    body: {
      type: 'bar',
      shapes: [
        {
          kind: 'rect',
          x: dx + stroke / 2,
          y: dy + stroke / 2,
          width: bar.width - stroke,
          height: bar.height - stroke,
        },
      ],
    },
  };
}
