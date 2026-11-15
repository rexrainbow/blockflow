import { textLines } from '../geometry.js';
import { TEXT_STYLE, BLOCK_STYLE, connectionStyle, paint, groupCornerRadius } from '../styles.js';
import { connectionLabels } from '../layout/edge-labels.js';

const MARGIN = 20;
import { escapeXml as escape, fillAttributes, strokeAttributes } from '../../shared/svg.js';

/** Draw existing geometry and text anchors without calculating layout. */
export function renderSvg(layout, { idPrefix = 'blockflow' } = {}) {
  const width = layout.width + 2 * MARGIN;
  const height = layout.height + 2 * MARGIN;
  const masks = layout.connections.map((connection) =>
    connection.style?.label?.hidden
      ? []
      : connectionLabels(connection).filter((label) => label.placement === 'inline'),
  );
  const maskId = (index) => escape(`${idPrefix}-connection-label-mask-${index}`);
  const lines = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="-20 -20 ${width} ${height}">`,
    `<rect x="-20" y="-20" width="${width}" height="${height}" fill="#ffffff"/>`,
    ...masks.flatMap((labels, index) =>
      labels.length
        ? [
            `<defs><mask id="${maskId(index)}" maskUnits="userSpaceOnUse" x="-20" y="-20" width="${width}" height="${height}"><rect x="-20" y="-20" width="${width}" height="${height}" fill="#ffffff"/>${labels.map(({ bounds: b }) => `<rect x="${b.x - 2}" y="${b.y - 2}" width="${b.width + 4}" height="${b.height + 4}" fill="#000000"/>`).join('')}</mask></defs>`,
          ]
        : [],
    ),
    '<g fill="none" stroke-linejoin="round">',
  ];
  for (const group of layout.groups ?? []) {
    if (group.collapsed) continue;
    const style = group.style,
      inset = style.borderWidth / 2;
    lines.push(
      `<rect data-role="group" data-group="${escape(group.id)}" x="${group.x + inset}" y="${group.y + inset}" width="${group.width - style.borderWidth}" height="${group.height - style.borderWidth}" ${roundingAttributes(group)}${fillAttributes(style.fillColor, style.fillOpacity)} ${strokeAttributes(style.borderColor, style.borderOpacity, style.borderWidth, style.borderStyle)}/>`,
    );
  }
  const netPaths = new Set(),
    netArrows = new Set();
  lines.push('<g data-role="connection-layer">');
  for (const connection of layout.connections) {
    const style = { ...connectionStyle(connection.width), ...connection.style };
    const stroke = strokeAttributes(style.strokeColor, style.opacity, style.strokeWidth, style.lineStyle);
    for (const [sectionIndex, section] of connection.sections.entries()) {
      const partStyle =
        connection.netStyle && sectionIndex < connection.netTrunkSections ? connection.netStyle : style;
      const partStroke = strokeAttributes(
        partStyle.strokeColor,
        partStyle.opacity,
        partStyle.strokeWidth,
        partStyle.lineStyle,
      );
      const d = section.points.map((point, i) => `${i === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ');
      const key = connection.netId ? connection.netId + ':' + d : null;
      if (key && netPaths.has(key)) continue;
      if (key) netPaths.add(key);
      lines.push(
        `<path d="${d}" ${partStroke}${masks[layout.connections.indexOf(connection)].length ? ` mask="url(#${maskId(layout.connections.indexOf(connection))})"` : ''}/>`,
      );
    }
    if (connection.startArrow) {
      const points = connection.startArrow.points.map((p) => `${p.x},${p.y}`).join(' '),
        key = connection.netId ? connection.netId + ':' + points : null;
      if (!key || !netArrows.has(key))
        lines.push(
          `<polygon data-role="connection-start-arrow" points="${points}" ${fillAttributes(connection.netStyle?.strokeColor ?? style.strokeColor, connection.netStyle?.opacity ?? style.opacity)} stroke="none"/>`,
        );
      if (key) netArrows.add(key);
    }
    if (connection.arrow)
      lines.push(
        `<polygon data-role="connection-arrow" points="${connection.arrow.points.map((p) => `${p.x},${p.y}`).join(' ')}" ${fillAttributes(style.strokeColor, style.opacity)} stroke="none"/>`,
      );
  }
  lines.push('</g>');
  lines.push('</g>', '<g>');
  for (const module of [...layout.modules, ...(layout.groups ?? []).filter((group) => group.collapsed)]) {
    const style = { ...BLOCK_STYLE, ...module.style };
    // The entire border fits inside the module's outer bounds and port anchors.
    const inset = style.borderWidth / 2;
    if (module.body) {
      lines.push(
        `<g data-role="block-body" data-appearance="${escape(module.body.type)}" transform="translate(${module.x} ${module.y})">`,
      );
      for (const shape of module.body.shapes) {
        const geometry =
          shape.kind === 'rect'
            ? `x="${shape.x}" y="${shape.y}" width="${shape.width}" height="${shape.height}"`
            : `points="${shape.points.map((p) => `${p.x},${p.y}`).join(' ')}"`;
        lines.push(
          `<${shape.kind === 'rect' ? 'rect' : 'polygon'} ${geometry} stroke-linejoin="round" ${fillAttributes(style.fillColor, style.fillOpacity)} ${strokeAttributes(style.borderColor, style.borderOpacity, style.borderWidth, style.borderStyle)}/>`,
        );
      }
      lines.push('</g>');
      continue;
    }
    // Backing cards stay within the reserved footprint and leave both port sides clear.
    for (let layer = module.stackLayers ?? 0; layer > 0; layer--) {
      const offset = layer * 6;
      lines.push(
        `<rect data-role="collection-layer" data-group="${escape(module.id)}" x="${module.x + offset + inset}" y="${module.y + offset + inset}" width="${module.width - offset - style.borderWidth}" height="${module.faceHeight - style.borderWidth}" ${roundingAttributes(module, module.width - offset, module.faceHeight)}${fillAttributes(style.fillColor, style.fillOpacity)} ${strokeAttributes(style.borderColor, style.borderOpacity, style.borderWidth, style.borderStyle)}/>`,
      );
    }
    lines.push(
      `<rect ${module.collapsed ? `data-role="group" data-group="${escape(module.id)}" data-collapsed="true" ` : ''}x="${module.x + inset}" y="${module.y + inset}" width="${module.width - style.borderWidth}" height="${(module.faceHeight ?? module.height) - style.borderWidth}" ${module.collapsed ? roundingAttributes(module) : ''}${fillAttributes(style.fillColor, style.fillOpacity)} ${strokeAttributes(style.borderColor, style.borderOpacity, style.borderWidth, style.borderStyle)}/>`,
    );
  }
  for (const group of layout.groups ?? [])
    for (const port of group.ports ?? [])
      lines.push(
        `<circle data-role="group-port" data-group="${escape(group.id)}" data-port="${escape(port.id)}" cx="${port.x}" cy="${port.y}" r="3" fill="#ffffff" ${strokeAttributes(group.style.borderColor, group.style.borderOpacity, 1.5, 'solid')}/>`,
      );
  lines.push('</g>', '<g fill="#000000" font-family="monospace" font-size="12" dominant-baseline="central">');
  function text(value, position, bounds, partial) {
    const style = { ...TEXT_STYLE, ...partial };
    if (style.hidden) return;
    const background = paint(style.backgroundColor, style.backgroundOpacity);
    const border = paint(style.borderColor ?? '#00000000', style.borderOpacity ?? 1);
    const borderWidth = border.opacity > 0 ? (style.borderWidth ?? 1) : 0;
    if (background.opacity > 0 || borderWidth > 0) {
      if (!bounds) throw new Error('Text background requires labelBounds from layout');
      // Keep frame ink inside the existing layout/hit bounds, including extreme widths.
      const stroke = Math.min(borderWidth, bounds.width, bounds.height),
        inset = stroke / 2;
      const width = Math.max(0, bounds.width - stroke),
        height = Math.max(0, bounds.height - stroke);
      const radius = Math.min(style.borderRadius ?? 0, width / 2, height / 2);
      const rounding = radius > 0 ? `rx="${radius}" ry="${radius}" ` : '';
      const frame =
        stroke > 0
          ? ` ${strokeAttributes(style.borderColor, style.borderOpacity ?? 1, stroke, 'solid')}`
          : '';
      lines.push(
        `<rect data-role="label-background" x="${bounds.x + inset}" y="${bounds.y + inset}" width="${width}" height="${height}" ${rounding}${fillAttributes(style.backgroundColor, style.backgroundOpacity)}${frame}/>`,
      );
    }
    const rows = textLines(value);
    const content =
      rows.length === 1
        ? escape(value)
        : rows
            .map(
              (row, i) =>
                `<tspan x="${position.x}" y="${position.y + (i - (rows.length - 1) / 2) * style.fontSize * 1.5}">${escape(row)}</tspan>`,
            )
            .join('');
    lines.push(
      `<text x="${position.x}" y="${position.y}" text-anchor="${escape(position.anchor)}" font-size="${style.fontSize}" ${fillAttributes(style.color, style.opacity)} xml:space="preserve">${content}</text>`,
    );
  }
  const sharedLabels = new Set();
  for (const connection of layout.connections)
    if (connection.label !== undefined && !connection.style.label.hidden)
      for (const label of connectionLabels(connection)) {
        if (label.sharedKey && sharedLabels.has(label.sharedKey)) continue;
        if (label.sharedKey) sharedLabels.add(label.sharedKey);
        lines.push(
          `<g data-role="connection-label" data-connection="${escape(connection.id)}" data-label-position="${escape(label.role)}" data-label-placement="${escape(label.placement)}"${label.connectionIds ? ` data-connections="${escape(label.connectionIds.join(' '))}"` : ''}>`,
        );
        if (label.leader) {
          const [a, b] = label.leader;
          lines.push(
            `<path data-role="label-leader" d="M ${a.x} ${a.y} L ${b.x} ${b.y}" fill="none" ${strokeAttributes(connection.style.strokeColor, connection.style.opacity, 1, 'solid')}/>`,
          );
          lines.push(
            `<circle data-role="label-anchor" cx="${a.x}" cy="${a.y}" r="1.5" ${fillAttributes(connection.style.strokeColor, connection.style.opacity)}/>`,
          );
        }
        text(connection.label, label.position, label.bounds, connection.style.label);
        lines.push('</g>');
      }
  for (const group of layout.groups ?? [])
    text(group.label, group.labelPosition, group.labelBounds, group.style.label);
  for (const terminal of layout.terminals ?? []) {
    lines.push(`<g data-role="terminal" data-terminal="${escape(terminal.id)}">`);
    text(terminal.displayName, terminal.labelPosition, terminal.labelBounds, terminal.style);
    lines.push('</g>');
  }
  for (const group of layout.groups ?? [])
    for (const port of group.ports ?? [])
      text(port.displayName, port.labelPosition, port.labelBounds, port.style);
  for (const module of layout.modules)
    text(module.label, module.labelPosition, module.labelBounds, module.style?.label);
  for (const module of layout.modules)
    for (const port of module.ports) text(port.displayName, port.labelPosition, port.labelBounds, port.style);
  if (layout.caption)
    text(layout.caption.text, layout.caption.labelPosition, layout.caption.labelBounds, layout.caption.style);
  lines.push('</g>', '</svg>');
  return lines.join('\n');
}

function roundingAttributes(group, width, height) {
  const radius = groupCornerRadius(group, width, height);
  return radius > 0 ? `rx="${radius}" ry="${radius}" ` : '';
}
