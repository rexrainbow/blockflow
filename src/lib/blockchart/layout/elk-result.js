import { absoluteGraph, groupResults } from './groups.js';
import { moduleGeometry, textBounds, textSize } from '../geometry.js';
import { terminalNodeId } from './elk-graph.js';
import { gridInternalEdges } from './grid-placement.js';

/** Own all mutable coordinates before Grid, alignment and routing adjustments. */
export function readElkResult(laidOut, model) {
  const { nodes, edges } = absoluteGraph(laidOut);
  let groups = groupResults(model, nodes);
  let terminals = (model.terminals ?? []).map((terminal) => {
    const node = nodes.get(terminalNodeId(terminal.id));
    const down = model.layout.direction === 'down',
      size = textSize(terminal.displayName, terminal.style),
      padding = terminal.style.hidden ? 0 : terminal.style.padding;
    const labelPosition = down
      ? {
          x: node.x + node.width / 2,
          y: node.y + padding + size.height / 2 + (terminal.direction === 'input' ? 0 : 16),
          anchor: 'middle',
        }
      : {
          x: node.x + padding + (terminal.direction === 'input' ? 0 : 16),
          y: node.y + node.height / 2,
          anchor: 'start',
        };
    return {
      ...structuredClone(terminal),
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      bitWidth: terminal.width,
      anchor: down
        ? { x: node.x + node.width / 2, y: node.y + (terminal.direction === 'input' ? node.height : 0) }
        : { x: node.x + (terminal.direction === 'input' ? node.width : 0), y: node.y + node.height / 2 },
      labelPosition,
      labelBounds: textBounds(terminal.displayName, labelPosition, terminal.style),
    };
  });
  let modules = model.modules.map((module) => {
    const node = nodes.get(module.id);
    const ports = new Map(node.ports.map((port) => [port.id, port]));
    const geometry = moduleGeometry(module, model.layout.direction);
    const labelPosition = { x: node.x + geometry.titleX, y: node.y + geometry.titleY, anchor: 'middle' };
    return {
      id: module.id,
      label: module.label,
      ...(module.type ? { type: module.type } : {}),
      ...(module._signalSize ? { _signalSize: module._signalSize } : {}),
      style: structuredClone(module.style),
      ...(geometry.body ? { body: structuredClone(geometry.body) } : {}),
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      labelPosition,
      labelBounds: textBounds(module.label, labelPosition, module.style.label),
      ports: module.ports.map((port) => {
        const placed = ports.get(`${module.id}.${port.id}`);
        const x = node.x + placed.x;
        const y = node.y + placed.y;
        const visible = !port.style.hidden;
        const inset =
          (port.direction === 'output'
            ? (geometry.outputLabelInset ?? geometry.portInset)
            : geometry.portInset) + (visible ? port.style.padding : 0);
        const local = geometry.portLabels?.[port.id];
        const labelPosition = local
          ? { ...local, x: node.x + local.x, y: node.y + local.y }
          : {
              x: x + (port.direction === 'input' ? inset : -inset),
              y,
              anchor: port.direction === 'input' ? 'start' : 'end',
            };
        return {
          id: port.id,
          direction: port.direction,
          side: port.side,
          displayName: port.displayName,
          width: port.width,
          x,
          y,
          style: structuredClone(port.style),
          labelPosition,
          labelBounds: visible
            ? textBounds(port.displayName, labelPosition, port.style)
            : { x, y, width: 0, height: 0 },
        };
      }),
    };
  });
  const anchorMap = new Map(
    [...modules, ...groups].flatMap((n) => n.ports.map((p) => [n.id + '.' + p.id, p])),
  );
  const anchor = (e) =>
    e.terminal !== undefined
      ? terminals.find((t) => t.id === e.terminal).anchor
      : anchorMap.get(e.moduleId + '.' + e.portId);
  const deferred = gridInternalEdges(model);
  let connections = model.connections.map((connection) => {
    const edge =
      edges.get(connection.id) ??
      (connection.constraint === false || deferred.has(connection.id)
        ? { sections: [{ startPoint: anchor(connection.source), endPoint: anchor(connection.target) }] }
        : undefined);
    if (!edge?.sections?.length) throw new Error(`Missing route: ${connection.id}`);
    return {
      id: connection.id,
      source: structuredClone(connection.originalSource ?? connection.source),
      target: structuredClone(connection.originalTarget ?? connection.target),
      ...(connection.netId
        ? {
            netId: connection.netId,
            connectionIndex: connection.connectionIndex,
            branchIndex: connection.branchIndex,
            netStyle: structuredClone(connection.netStyle),
          }
        : {}),
      ...(connection.originalSource
        ? {
            routingSource: structuredClone(connection.source),
            routingTarget: structuredClone(connection.target),
          }
        : {}),
      width: connection.width,
      feedback: connection.feedback,
      style: structuredClone(connection.style),
      ...(connection.direction ? { direction: connection.direction } : {}),
      ...(connection.constraint !== undefined ? { constraint: connection.constraint } : {}),
      ...(connection.scope !== undefined ? { scope: connection.scope } : {}),
      ...(connection.label !== undefined ? { label: connection.label } : {}),
      sections: edge.sections.map((section) => ({
        points: [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map((point) => ({
          x: point.x,
          y: point.y,
        })),
      })),
    };
  });

  return { modules, groups, terminals, connections };
}
