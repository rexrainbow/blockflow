import { textSize } from '../shared/text.js';
import { LAYOUT_DEFAULTS } from './layout-defaults.js';

/** Title-only face; hidden Port slots are added separately by sidedGeometry. */
export function titleGeometry(module, direction, unit) {
  const profile = LAYOUT_DEFAULTS,
    stroke = module.style.borderWidth;
  const label = module.style.label,
    text = textSize(module.label, label);
  const padding = label.hidden ? 0 : label.padding;
  const type = module.appearance?.type ?? 'rectangle';
  const ratio = type === 'trapezoid' ? module.appearance.rightHeightRatio : 1;
  const width = Math.max(
    profile.blockMinWidth,
    (module.width ?? 0) * unit.width,
    (text.width + 2 * padding + 2 * profile.blockPaddingX + 2 * stroke) / (direction === 'down' ? ratio : 1),
  );
  const height = Math.max(
    profile.blockMinHeight,
    (module.height ?? 0) * unit.height,
    (text.height + 2 * padding + 2 * profile.blockPaddingY + 2 * stroke) / (direction === 'down' ? 1 : ratio),
  );
  const extra = type === 'stacked' ? module.appearance.layers * 6 : 0;
  let body;
  if (type === 'stacked')
    body = {
      type,
      shapes: Array.from({ length: module.appearance.layers + 1 }, (_, i) => {
        const offset = (module.appearance.layers - i) * 6;
        return {
          kind: 'rect',
          x: offset + stroke / 2,
          y: offset + stroke / 2,
          width: width - stroke,
          height: height - stroke,
        };
      }),
    };
  if (type === 'trapezoid') {
    const half = stroke / 2;
    body = {
      type,
      shapes: [
        {
          kind: 'polygon',
          points:
            direction === 'down'
              ? [
                  { x: half, y: half },
                  { x: width - half, y: half },
                  { x: (width * (1 + ratio)) / 2 - half, y: height - half },
                  { x: (width * (1 - ratio)) / 2 + half, y: height - half },
                ]
              : [
                  { x: half, y: half },
                  { x: width - half, y: (height * (1 - ratio)) / 2 + half },
                  { x: width - half, y: (height * (1 + ratio)) / 2 - half },
                  { x: half, y: height - half },
                ],
        },
      ],
    };
  }
  return {
    width: width + extra,
    height: height + extra,
    titleX: width / 2,
    titleY: height / 2,
    rowCenters: [],
    portInset: 0,
    portPoints: {},
    ...(body ? { body } : {}),
  };
}
