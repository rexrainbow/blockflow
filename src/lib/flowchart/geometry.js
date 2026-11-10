import { textSize, textBounds } from '../shared/text.js';

export const vectors = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  top: { x: 0, y: -1 },
  bottom: { x: 0, y: 1 },
};
export const opposite = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' };
export function measureNode(node) {
  const size = textSize(node.label, node.style),
    pad = node.style.padding + node.style.borderWidth;
  const diamond = node.type === 'decision';
  return {
    width: Math.max(
      diamond ? 140 : 120,
      (size.width + 2 * pad) * (diamond ? 2 : 1) + (node.type === 'note' ? 14 : 0),
      node.width ?? 0,
    ),
    height: Math.max(diamond ? 80 : 50, (size.height + 2 * pad) * (diamond ? 2 : 1), node.height ?? 0),
  };
}
export function sidePoint(node, side) {
  return {
    x: side === 'left' ? node.x : side === 'right' ? node.x + node.width : node.x + node.width / 2,
    y: side === 'top' ? node.y : side === 'bottom' ? node.y + node.height : node.y + node.height / 2,
  };
}
export function nodeText(node) {
  const position = {
    x: node.x + node.width / 2 - (node.type === 'note' ? 7 : 0),
    y: node.y + node.height / 2,
    anchor: 'middle',
  };
  return { position, bounds: textBounds(node.label, position, { ...node.style, padding: 0 }) };
}
