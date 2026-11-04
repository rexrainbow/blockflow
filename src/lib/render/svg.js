import { textLines } from '../geometry.js';
import { TEXT_STYLE, BLOCK_STYLE, connectionStyle, paint, linePattern } from '../styles.js';

const MARGIN = 20;
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);

/** Draw existing geometry and text anchors without calculating layout. */
export function renderSvg(layout) {
  const width = layout.width + 2 * MARGIN;
  const height = layout.height + 2 * MARGIN;
  const lines = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="-20 -20 ${width} ${height}">`,
    `<rect x="-20" y="-20" width="${width}" height="${height}" fill="#ffffff"/>`,
    '<g fill="none" stroke-linejoin="round">',
  ];
  for (const group of layout.groups ?? []) {
    if(group.collapsed) continue;
    const style = group.style, inset = style.borderWidth / 2;
    lines.push(`<rect data-role="group" data-group="${escape(group.id)}" x="${group.x + inset}" y="${group.y + inset}" width="${group.width - style.borderWidth}" height="${group.height - style.borderWidth}" ${fillAttributes(style.fillColor, style.fillOpacity)} ${strokeAttributes(style.borderColor, style.borderOpacity, style.borderWidth, style.borderStyle)}/>`);
  }
  for (const connection of layout.connections) {
    const style = { ...connectionStyle(connection.width), ...connection.style };
    const stroke = strokeAttributes(style.strokeColor, style.opacity, style.strokeWidth, style.lineStyle);
    for (const section of connection.sections) {
      const d = section.points.map((point, i) => `${i === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
      lines.push(`<path d="${d}" ${stroke}/>`);
    }
  }
  lines.push('</g>', '<g>');
  for (const module of [...layout.modules,...(layout.groups??[]).filter(group=>group.collapsed)]) {
    const style = { ...BLOCK_STYLE, ...module.style };
    // The entire border fits inside the module's outer bounds and port anchors.
    const inset = style.borderWidth / 2;
    // Backing cards stay within the reserved footprint and leave both port sides clear.
    for(let layer=module.stackLayers??0;layer>0;layer--) {
      const offset=layer*6;
      lines.push(`<rect data-role="collection-layer" data-group="${escape(module.id)}" x="${module.x+offset+inset}" y="${module.y+offset+inset}" width="${module.width-offset-style.borderWidth}" height="${module.faceHeight-style.borderWidth}" ${fillAttributes(style.fillColor,style.fillOpacity)} ${strokeAttributes(style.borderColor,style.borderOpacity,style.borderWidth,style.borderStyle)}/>`);
    }
    lines.push(`<rect ${module.collapsed?`data-role="group" data-group="${escape(module.id)}" data-collapsed="true" `:''}x="${module.x + inset}" y="${module.y + inset}" width="${module.width - style.borderWidth}" height="${(module.faceHeight??module.height) - style.borderWidth}" ${fillAttributes(style.fillColor, style.fillOpacity)} ${strokeAttributes(style.borderColor, style.borderOpacity, style.borderWidth, style.borderStyle)}/>`);
  }
  for(const group of layout.groups??[]) for(const port of group.ports??[]) lines.push(`<circle data-role="group-port" data-group="${escape(group.id)}" data-port="${escape(port.id)}" cx="${port.x}" cy="${port.y}" r="3" fill="#ffffff" ${strokeAttributes(group.style.borderColor,group.style.borderOpacity,1.5,'solid')}/>`);
  lines.push('</g>', '<g fill="#000000" font-family="monospace" font-size="12" dominant-baseline="central">');
  function text(value, position, bounds, partial) {
    const style = { ...TEXT_STYLE, ...partial };
    const background = paint(style.backgroundColor, style.backgroundOpacity);
    if (background.opacity > 0) {
      if (!bounds) throw new Error('Text background requires labelBounds from layout');
      lines.push(`<rect data-role="label-background" x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" ${fillAttributes(style.backgroundColor, style.backgroundOpacity)}/>`);
    }
    const rows = textLines(value);
    const content = rows.length === 1 ? escape(value) : rows.map((row, i) =>
      `<tspan x="${position.x}" y="${position.y + (i - (rows.length - 1) / 2) * style.fontSize * 1.5}">${escape(row)}</tspan>`).join('');
    lines.push(`<text x="${position.x}" y="${position.y}" text-anchor="${escape(position.anchor)}" font-size="${style.fontSize}" ${fillAttributes(style.color, style.opacity)} xml:space="preserve">${content}</text>`);
  }
  for (const connection of layout.connections) if (connection.label !== undefined) {
    lines.push(`<g data-role="connection-label" data-connection="${escape(connection.id)}">`);
    text(connection.label, connection.labelPosition, connection.labelBounds, connection.style.label);
    lines.push('</g>');
  }
  for (const group of layout.groups ?? []) text(group.label, group.labelPosition, group.labelBounds, group.style.label);
  for(const group of layout.groups??[]) for(const port of group.ports??[]) text(port.displayName,port.labelPosition,port.labelBounds,port.style);
  for (const module of layout.modules) text(module.label, module.labelPosition, module.labelBounds, module.style?.label);
  for (const module of layout.modules) for (const port of module.ports) text(port.displayName, port.labelPosition, port.labelBounds, port.style);
  lines.push('</g>', '</svg>');
  return lines.join('\n');
}

function fillAttributes(color, opacity) {
  const fill = paint(color, opacity);
  return `fill="${fill.color}" fill-opacity="${fill.opacity}"`;
}

function strokeAttributes(color, opacity, width, lineStyle) {
  const stroke = paint(color, opacity);
  const pattern = linePattern(lineStyle, width);
  return `stroke="${stroke.color}" stroke-opacity="${stroke.opacity}" stroke-width="${width}" stroke-linecap="${pattern.cap}"${pattern.dash ? ` stroke-dasharray="${pattern.dash}"` : ''}`;
}
