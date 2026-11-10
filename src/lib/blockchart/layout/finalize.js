import { translateNode, translateConnection } from './translate.js';
import { applyConnectionArrows } from './arrows.js';
import { placeEdgeLabels, connectionLabels } from './edge-labels.js';
import { textBounds, textSize } from '../geometry.js';
import { TEXT_STYLE } from '../styles.js';

/** Finalize semantic routes, translate to the origin, and add the diagram caption. */
export function finalizeLayout({ modules, groups, terminals, connections }, model) {
  applyConnectionArrows(connections);
  const warnings = placeEdgeLabels({ modules, groups, terminals, connections });
  const allPoints = [
    ...connections.flatMap((edge) => [...(edge.arrow?.points ?? []), ...(edge.startArrow?.points ?? [])]),
    ...connections.flatMap((edge) =>
      connectionLabels(edge).flatMap((label) => [
        label.bounds,
        { x: label.bounds.x + label.bounds.width, y: label.bounds.y + label.bounds.height },
        ...(label.leader ?? []),
      ]),
    ),
    ...[...modules, ...groups, ...terminals].flatMap((module) => [
      { x: module.x, y: module.y },
      { x: module.x + module.width, y: module.y + module.height },
    ]),
    ...connections.flatMap((connection) =>
      connection.sections.flatMap((section) =>
        section.points.flatMap((point) => {
          const half = connection.style.strokeWidth / 2;
          return [
            { x: point.x - half, y: point.y - half },
            { x: point.x + half, y: point.y + half },
          ];
        }),
      ),
    ),
  ];
  if (allPoints.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y)))
    throw new Error('Non-finite layout coordinate');
  const minX = Math.min(...allPoints.map((p) => p.x));
  const minY = Math.min(...allPoints.map((p) => p.y));
  const width = Math.max(...allPoints.map((p) => p.x)) - minX;
  const height = Math.max(...allPoints.map((p) => p.y)) - minY;
  if (!Number.isFinite(width) || !Number.isFinite(height)) throw new Error('Non-finite layout bounds');
  for (const node of [...terminals, ...groups, ...modules]) translateNode(node, -minX, -minY);
  for (const connection of connections) translateConnection(connection, -minX, -minY);
  const result = {
    width,
    height,
    modules,
    connections,
    ...(terminals.length ? { terminals } : {}),
    ...(warnings.length ? { warnings } : {}),
    ...(groups.length ? { groups } : {}),
  };
  if (model.diagram.caption !== undefined) {
    const style = { ...TEXT_STYLE, ...model.diagram.style.caption },
      size = textSize(model.diagram.caption, style),
      pad = style.hidden ? 0 : style.padding;
    const labelPosition = {
        x: pad,
        y: result.height + (style.hidden ? 0 : 12 + pad + size.height / 2),
        anchor: 'start',
      },
      labelBounds = textBounds(model.diagram.caption, labelPosition, style);
    if (
      ![
        labelBounds.x,
        labelBounds.y,
        labelBounds.width,
        labelBounds.height,
        labelBounds.y + labelBounds.height,
      ].every(Number.isFinite)
    )
      throw new Error('Non-finite caption bounds');
    result.caption = { text: model.diagram.caption, style, labelPosition, labelBounds };
    if (!style.hidden) {
      result.width = Math.max(result.width, labelBounds.width);
      result.height = labelBounds.y + labelBounds.height;
    }
  }
  return result;
}
