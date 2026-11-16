import { escapeXml as escape, fillAttributes as fill, strokeAttributes as stroke } from '../../shared/svg.js';
import { textLines, alignedTextPosition } from '../../shared/text.js';

/** Render existing Flowchart geometry without executing HTML or measuring browser text. */
export function renderFlowchartSvg(layout) {
  return renderGraphSvg(layout);
}
/** Internal node-rendering seam; edges, labels and SVG escaping stay shared. */
export function renderGraphSvg(layout, renderNode) {
  const out = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}">`,
    `<title>${escape(layout.diagram.name)}</title>`,
    `<rect width="${layout.width}" height="${layout.height}" fill="#ffffff"/>`,
  ];
  function text(value, position, style) {
    const rows = textLines(value);
    position = alignedTextPosition(value, position, style);
    out.push(
      `<text x="${position.x}" y="${position.y}" text-anchor="${position.anchor}" dominant-baseline="central" font-family="monospace" font-size="${style.fontSize}" ${fill(style.color, style.opacity ?? 1)} xml:space="preserve">${rows.map((row, i) => `<tspan x="${position.x}" y="${position.y + (i - (rows.length - 1) / 2) * style.fontSize * 1.5}">${escape(row)}</tspan>`).join('')}</text>`,
    );
  }
  for (const g of layout.groups) {
    const s = g.style,
      h = s.borderWidth / 2;
    out.push(
      `<rect data-role="flow-group" data-id="${escape(g.id)}" x="${g.x + h}" y="${g.y + h}" width="${Math.max(0, g.width - s.borderWidth)}" height="${Math.max(0, g.height - s.borderWidth)}" rx="${Math.min(s.borderRadius, g.width / 2, g.height / 2)}" ${fill(s.fillColor, s.opacity)} ${stroke(s.borderColor, s.opacity, s.borderWidth, s.borderStyle)}/>`,
    );
  }
  for (const e of layout.edges) {
    const s = e.style;
    out.push(`<g data-role="flow-edge" data-id="${escape(e.id)}" data-kind="${e.kind}">`);
    for (const section of e.sections) {
      const p = section.points;
      out.push(
        `<path d="${p.map((q, i) => (i ? 'L' : 'M') + ' ' + q.x + ' ' + q.y).join(' ')}" fill="none" stroke-linejoin="round" ${stroke(s.strokeColor, s.opacity, s.strokeWidth, s.lineStyle)}/>`,
      );
    }
    if (e.arrow) {
      const p = e.sections.at(-1).points,
        tip = p.at(-1),
        before = [...p.slice(0, -1)].reverse().find((q) => Math.hypot(tip.x - q.x, tip.y - q.y) > 1e-6);
      if (before) {
        const distance = Math.hypot(tip.x - before.x, tip.y - before.y),
          size = Math.min(Math.max(8, s.strokeWidth * 3), distance),
          dx = (tip.x - before.x) / distance,
          dy = (tip.y - before.y) / distance,
          x = tip.x - dx * size,
          y = tip.y - dy * size;
        out.push(
          `<polygon data-role="flow-arrow" points="${tip.x},${tip.y} ${x - (dy * size) / 2},${y + (dx * size) / 2} ${x + (dy * size) / 2},${y - (dx * size) / 2}" ${fill(s.strokeColor, s.opacity)}/>`,
        );
      }
    }
    out.push('</g>');
  }
  for (const n of layout.nodes) {
    if (renderNode) {
      out.push(renderNode(n));
      continue;
    }
    const s = n.style,
      h = s.borderWidth / 2,
      x = n.x + h,
      y = n.y + h,
      w = Math.max(0, n.width - s.borderWidth),
      height = Math.max(0, n.height - s.borderWidth);
    out.push(`<g data-role="flow-node" data-id="${escape(n.id)}" data-type="${n.type}">`);
    const attributes = `${fill(s.fillColor, s.opacity)} ${stroke(s.borderColor, s.opacity, s.borderWidth, s.borderStyle)}`;
    if (n.type === 'decision')
      out.push(
        `<polygon points="${x + w / 2},${y} ${x + w},${y + height / 2} ${x + w / 2},${y + height} ${x},${y + height / 2}" ${attributes}/>`,
      );
    else if (n.type === 'note') {
      const fold = Math.min(14, w / 3, height / 3);
      out.push(
        `<path d="M ${x} ${y} L ${x + w - fold} ${y} L ${x + w} ${y + fold} L ${x + w} ${y + height} L ${x} ${y + height} Z" ${attributes}/>`,
      );
      out.push(
        `<path d="M ${x + w - fold} ${y} L ${x + w - fold} ${y + fold} L ${x + w} ${y + fold}" fill="none" ${stroke(s.borderColor, s.opacity, s.borderWidth, s.borderStyle)}/>`,
      );
    } else {
      const radius = ['terminator', 'start', 'end'].includes(n.type)
        ? height / 2
        : Math.min(s.borderRadius, w / 2, height / 2);
      out.push(`<rect x="${x}" y="${y}" width="${w}" height="${height}" rx="${radius}" ${attributes}/>`);
    }
    text(n.label, n.labelPosition, s);
    out.push('</g>');
  }
  for (const e of layout.edges)
    if (e.label !== undefined) {
      const b = e.labelBounds,
        s = e.style;
      out.push(
        `<g data-role="flow-edge-label" data-id="${escape(e.id)}"><rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" ${fill(s.labelBackgroundColor, s.opacity)}/>`,
      );
      text(e.displayLabel ?? e.label, e.labelPosition, s);
      out.push('</g>');
    }
  for (const g of layout.groups) text(g.label, g.labelPosition, g.style);
  if (layout.caption)
    text(layout.caption.text, layout.caption.position, { fontSize: 11, color: '#52606D', opacity: 1 });
  out.push('</svg>');
  return out.join('\n');
}
