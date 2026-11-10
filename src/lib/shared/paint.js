// Split alpha from hex to avoid depending on CSS Color 4 parsing in exporters.
export function paint(color, opacity = 1) {
  return {
    color: color.slice(0, 7),
    opacity: opacity * (color.length === 9 ? parseInt(color.slice(7), 16) / 255 : 1),
  };
}

export function linePattern(style, width) {
  if (style === 'dashed') return { dash: `${4 * width} ${2 * width}`, cap: 'butt' };
  if (style === 'dotted') return { dash: `0 ${3 * width}`, cap: 'round' };
  return { cap: 'butt' };
}
