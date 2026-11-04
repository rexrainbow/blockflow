import { edgeLabelSize, placeEdgeLabels } from './edge-labels.js';
import ELK from 'elkjs/lib/elk.bundled.js';
import { applyGroups, absoluteGraph, groupResults, preserveGroupPortOrder } from './groups.js';
import { routeOuterFeedback } from './outer-feedback.js';
import { moduleGeometry, textBounds } from '../geometry.js';
import { connectionStyle } from '../styles.js';
import { visibleModel } from './visibility.js';
import { scopeModel } from './scope.js';

export class DiagramLayoutError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'DiagramLayoutError';
  }
}

const ref = endpoint => `${endpoint.moduleId}.${endpoint.portId}`;

// Keep the baseline untouched; each alternative changes one placement option.
const PLACEMENT_OPTIONS = {
  default: {},
  relaxed: { 'elk.layered.nodePlacement.favorStraightEdges': 'false' },
  simple: { 'elk.layered.nodePlacement.strategy': 'SIMPLE' },
};

function toLayoutResult(laidOut, model) {
    const { nodes, edges } = absoluteGraph(laidOut);
    const groups = groupResults(model, nodes);
    const modules = model.modules.map(module => {
      const node = nodes.get(module.id);
      const ports = new Map(node.ports.map(port => [port.id, port]));
      const geometry = moduleGeometry(module);
      const labelPosition = { x: node.x + node.width / 2, y: node.y + geometry.titleY, anchor: 'middle' };
      return {
        id: module.id, label: module.label,
        style: structuredClone(module.style),
        x: node.x, y: node.y, width: node.width, height: node.height,
        labelPosition,
        labelBounds: textBounds(module.label, labelPosition, module.style.label),
        ports: module.ports.map(port => {
          const placed = ports.get(`${module.id}.${port.id}`);
          const x = node.x + placed.x;
          const y = node.y + placed.y;
          const inset = geometry.portInset + port.style.padding;
          const labelPosition = { x: x + (port.direction === 'input' ? inset : -inset), y, anchor: port.direction === 'input' ? 'start' : 'end' };
          return {
            id: port.id, direction: port.direction, displayName: port.displayName, width: port.width, x, y,
            style: structuredClone(port.style), labelPosition,
            labelBounds: textBounds(port.displayName, labelPosition, port.style),
          };
        }),
      };
    });
    const connections = model.connections.map(connection => {
      const edge = edges.get(connection.id);
      if (!edge?.sections?.length) throw new Error(`Missing route: ${connection.id}`);
      return {
        id: connection.id, source: structuredClone(connection.originalSource??connection.source), target: structuredClone(connection.originalTarget??connection.target),
        ...(connection.originalSource?{routingSource:structuredClone(connection.source),routingTarget:structuredClone(connection.target)}:{}), width: connection.width, feedback: connection.feedback,
        style: structuredClone(connection.style),
        ...(connection.scope!==undefined?{scope:connection.scope}:{}),
        ...(connection.label !== undefined ? { label: connection.label,
          ...(edge.labels?.[0] ? { labelHint: { x: edge.labels[0].x + edge.labels[0].width / 2, y: edge.labels[0].y + edge.labels[0].height / 2 } } : {}),
        } : {}),
        sections: edge.sections.map(section => ({
          points: [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map(point => ({ x: point.x, y: point.y })),
        })),
      };
    });

    preserveGroupPortOrder(groups, connections);
    if (model.layout?.feedbackRouting === 'outer') routeOuterFeedback({ modules, groups, connections }, model);
    const warnings = placeEdgeLabels({ modules, groups, connections });
    const allPoints = [
      ...connections.filter(edge => edge.labelBounds).flatMap(edge => [edge.labelBounds,
        { x: edge.labelBounds.x + edge.labelBounds.width, y: edge.labelBounds.y + edge.labelBounds.height }]),
      ...[...modules, ...groups].flatMap(module => [{ x: module.x, y: module.y }, { x: module.x + module.width, y: module.y + module.height }]),
      ...connections.flatMap(connection => connection.sections.flatMap(section => section.points.flatMap(point => {
        const half = connection.style.strokeWidth / 2;
        return [{ x: point.x - half, y: point.y - half }, { x: point.x + half, y: point.y + half }];
      }))),
    ];
    if (allPoints.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) throw new Error('Non-finite layout coordinate');
    const minX = Math.min(...allPoints.map(p => p.x));
    const minY = Math.min(...allPoints.map(p => p.y));
    const width = Math.max(...allPoints.map(p => p.x)) - minX;
    const height = Math.max(...allPoints.map(p => p.y)) - minY;
    if (!Number.isFinite(width) || !Number.isFinite(height)) throw new Error('Non-finite layout bounds');
    function shift(point) { point.x -= minX; point.y -= minY; }
    for (const group of groups) { shift(group); shift(group.labelPosition); shift(group.labelBounds);
      for(const port of group.ports??[]) {shift(port);shift(port.labelPosition);shift(port.labelBounds);}
    }
    for (const module of modules) {
      shift(module);
      shift(module.labelPosition);
      shift(module.labelBounds);
      for (const port of module.ports) { shift(port); shift(port.labelPosition); shift(port.labelBounds); }
    }
    for (const connection of connections) {
      for (const section of connection.sections) for (const point of section.points) shift(point);
      for (const point of connection.routingInfo?.waypoints ?? []) shift(point);
      if (connection.labelPosition) { shift(connection.labelPosition); shift(connection.labelBounds); }
    }
    const result = { width, height, modules, connections, ...(warnings.length ? { warnings } : {}), ...(groups.length ? { groups } : {}) };
    return result;
}

/** ELK produces placement/routes; an optional AABB pass replaces feedback routes. */
export async function layoutDiagram(model, options = {}) {
  try {
    model = scopeModel(model, options.rootGroupId);
    model = visibleModel(model);
    const geometry = new Map(model.modules.map(module => [module.id, moduleGeometry(module)]));
    const strokeWidth = Math.max(0, ...model.connections.map(c => c.style.strokeWidth));
    const extraStroke = Math.max(0, ...model.connections.map(c => c.style.strokeWidth - connectionStyle(c.width).strokeWidth));
    const graph = {
      id: '@root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': model.layout.direction.toUpperCase(),
        'elk.edgeRouting': 'ORTHOGONAL',
        'elk.spacing.nodeNode': String(model.layout.moduleSpacing + extraStroke),
        'elk.layered.spacing.nodeNodeBetweenLayers': String(model.layout.layerSpacing + extraStroke),
        'elk.spacing.componentComponent': String(model.layout.moduleSpacing + extraStroke),
        'elk.layered.mergeEdges': 'false',
        'elk.randomSeed': '1',
        ...PLACEMENT_OPTIONS[model.layout.placement ?? 'default'],
        ...(extraStroke > 0 ? {
          'elk.spacing.edgeNode': String(10 + strokeWidth / 2),
          'elk.layered.spacing.edgeNodeBetweenLayers': String(10 + strokeWidth / 2),
          'elk.spacing.edgeEdge': String(10 + strokeWidth),
          'elk.layered.spacing.edgeEdgeBetweenLayers': String(10 + strokeWidth),
        } : {}),
      },
      children: model.modules.map(module => {
        const { width, height, rowCenters } = geometry.get(module.id);
        return {
          id: module.id, width, height,
          layoutOptions: { 'elk.portConstraints': 'FIXED_POS' },
          ports: module.ports.map(port => ({
            id: `${module.id}.${port.id}`, width: 0, height: 0,
            x: port.direction === 'input' ? 0 : width,
            y: rowCenters[port.order],
            layoutOptions: { 'elk.port.side': port.direction === 'input' ? 'WEST' : 'EAST' },
          })),
        };
      }),
      edges: model.connections.map(connection => ({
        id: `@${connection.id}`, sources: [ref(connection.source)], targets: [ref(connection.target)],
        layoutOptions: { 'elk.layered.priority.direction': connection.feedback ? '0' : '10' },
        ...(connection.label !== undefined ? { labels: [{ id: '@label_' + connection.id, text: connection.label,
          width: edgeLabelSize(connection).width + 16, height: edgeLabelSize(connection).height + 12,
          layoutOptions: { 'elk.edgeLabels.placement': 'CENTER', 'elk.edgeLabels.inline': 'false' },
        }] } : {}),
      })),
    };
    applyGroups(graph, model);
    const elk = new ELK();
    let best;
    // At most two spacing retries; unlabeled diagrams retain the original pass.
    for (let attempt = 0; attempt < 3; attempt++) {
      const candidate = structuredClone(graph);
      const increase = attempt * Math.max(40, ...model.connections.filter(edge => edge.label !== undefined).map(edge => edgeLabelSize(edge).width / 2));
      function widen(node) {
        if (attempt) for (const key of ['elk.spacing.nodeNode', 'elk.layered.spacing.nodeNodeBetweenLayers', 'elk.spacing.componentComponent']) {
          if (node.layoutOptions?.[key] !== undefined) node.layoutOptions[key] = String(Number(node.layoutOptions[key]) + increase);
        }
        for (const child of node.children ?? []) widen(child);
      }
      widen(candidate);
      try {
        const result = toLayoutResult(await elk.layout(candidate), model);
        if (!best || (result.warnings?.length ?? 0) < (best.warnings?.length ?? 0)) best = result;
        if (!result.warnings?.length) break;
      } catch (error) {
        if (!best) throw error;
        // A failed spacing retry must not discard a usable annotated diagram.
        break;
      }
    }
    return model.rootGroupId ? {...best,rootGroupId:model.rootGroupId} : best;
  } catch (cause) {
    throw new DiagramLayoutError(`Layout failed: ${cause.message}`, { cause });
  }
}
