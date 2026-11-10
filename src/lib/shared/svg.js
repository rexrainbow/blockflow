import { paint, linePattern } from './paint.js';
export const escapeXml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char],
  );
export function fillAttributes(color, opacity) {
  const fill = paint(color, opacity);
  return `fill="${fill.color}" fill-opacity="${fill.opacity}"`;
}

export function strokeAttributes(color, opacity, width, lineStyle) {
  const stroke = paint(color, opacity);
  const pattern = linePattern(lineStyle, width);
  return `stroke="${stroke.color}" stroke-opacity="${stroke.opacity}" stroke-width="${width}" stroke-linecap="${pattern.cap}"${pattern.dash ? ` stroke-dasharray="${pattern.dash}"` : ''}`;
}
