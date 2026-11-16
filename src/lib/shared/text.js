export const TEXT_STYLE = Object.freeze({
  color: '#000000',
  fontSize: 12,
  backgroundColor: '#00000000',
  padding: 0,
  opacity: 1,
  backgroundOpacity: 1,
  hidden: false,
});
export const textLines = (value) => value.replace(/\r\n/g, '\n').split('\n');

// Conservative monospace estimate, preserving single-line measurements.
export function textSize(value, style = TEXT_STYLE) {
  if (style.hidden) return { width: 0, height: 0 };
  const lines = textLines(value);
  return {
    width:
      (Math.max(
        ...lines.map((line) =>
          Array.from(line).reduce((sum, char) => sum + (char.codePointAt(0) <= 127 ? 8 : 16), 0),
        ),
      ) *
        style.fontSize) /
      12,
    height: lines.length * style.fontSize * 1.5,
  };
}

export function textBounds(value, position, style) {
  if (style.hidden) return { x: position.x, y: position.y, width: 0, height: 0 };
  const size = textSize(value, style);
  const offset = position.anchor === 'middle' ? size.width / 2 : position.anchor === 'end' ? size.width : 0;
  return {
    x: position.x - offset - style.padding,
    y: position.y - size.height / 2 - style.padding,
    width: size.width + 2 * style.padding,
    height: size.height + 2 * style.padding,
  };
}

/** Align lines inside their measured block, without moving its existing bounds. */
export function alignedTextPosition(value, position, style, align = style.textAlign) {
  if (align === undefined || textLines(value).length === 1) return position;
  const width = textSize(value, style).width;
  const left =
    position.x - (position.anchor === 'middle' ? width / 2 : position.anchor === 'end' ? width : 0);
  const anchor = { left: 'start', center: 'middle', right: 'end' }[align];
  return { ...position, anchor, x: left + (align === 'center' ? width / 2 : align === 'right' ? width : 0) };
}
