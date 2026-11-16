import { alignedTextPosition } from '../shared/text.js';
import { renderGraphSvg } from '../flowchart/render/svg.js';
import { escapeXml, fillAttributes, strokeAttributes } from '../shared/svg.js';

export function renderStatechartSvg(layout) {
  return renderGraphSvg({ ...layout, nodes: layout.states, edges: layout.transitions, groups: [] }, (n) => {
    const s = n.style,
      x = n.x,
      y = n.y,
      w = n.width,
      h = n.height,
      cx = x + w / 2,
      cy = y + h / 2;
    const fill = fillAttributes(s.fillColor, s.opacity),
      stroke = strokeAttributes(s.borderColor, s.opacity, s.borderWidth, s.borderStyle);
    const out = [`<g data-role="statechart-state" data-id="${escapeXml(n.id)}" data-kind="${n.kind}">`];
    if (n.kind !== 'state') {
      const radius = (Math.min(w, h) - s.borderWidth) / 2;
      out.push(
        `<circle cx="${cx}" cy="${cy}" r="${radius}" ${n.kind === 'initial' ? fillAttributes(s.borderColor, s.opacity) : fill} ${stroke}/>`,
      );
      if (n.kind === 'final')
        out.push(
          `<circle cx="${cx}" cy="${cy}" r="${Math.max(1, radius - 4)}" ${fillAttributes(s.borderColor, s.opacity)}/>`,
        );
    } else {
      out.push(
        `<rect x="${x + s.borderWidth / 2}" y="${y + s.borderWidth / 2}" width="${w - s.borderWidth}" height="${h - s.borderWidth}" rx="${Math.min(s.borderRadius, w / 2, h / 2)}" ${fill} ${stroke}/>`,
      );
      const rows = (n.label ?? n.id).split(/\r?\n/),
        body = n.description?.split(/\r?\n/) ?? [],
        line = s.fontSize * 1.5;
      const all = rows.length + body.length,
        top = cy - ((all - 1) * line) / 2;
      function text(value, ty, position) {
        out.push(
          `<text x="${position.x}" y="${ty}" text-anchor="${position.anchor}" dominant-baseline="central" font-family="monospace" font-size="${s.fontSize}" ${fillAttributes(s.color, s.opacity)} xml:space="preserve">${escapeXml(value)}</text>`,
        );
      }
      const titlePosition = alignedTextPosition(rows.join('\n'), { x: cx, anchor: 'middle' }, s);
      const bodyPosition = alignedTextPosition(
        body.join('\n'),
        { x: cx, anchor: 'middle' },
        s,
        s.descriptionAlign ?? s.textAlign,
      );
      rows.forEach((r, i) => text(r, top + i * line, titlePosition));
      if (body.length) {
        const divider = top + (rows.length - 0.5) * line;
        out.push(`<path d="M ${x} ${divider} H ${x + w}" fill="none" ${stroke}/>`);
        body.forEach((r, i) => text(r, top + (rows.length + i) * line, bodyPosition));
      }
    }
    out.push('</g>');
    return out.join('\n');
  });
}
