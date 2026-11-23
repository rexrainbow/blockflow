import { LAYOUT_DEFAULTS } from '../layout-defaults.js';
import { routingSpacing } from './routing-spacing.js';
import { applyGroups } from './groups.js';
import { budgetContainerSpacing } from './container-spacing.js';
import { moduleGeometry, textSize } from '../geometry.js';
import { portSide } from '../direction.js';
import { gridInternalEdges } from './grid-placement.js';

export const terminalNodeId = (id) => `@terminal:${id}`;
const ref = (endpoint) =>
  endpoint.terminal !== undefined
    ? `${terminalNodeId(endpoint.terminal)}.anchor`
    : `${endpoint.moduleId}.${endpoint.portId}`;
function terminalGeometry(terminal, direction) {
  const size = textSize(terminal.displayName, terminal.style),
    padding = terminal.style.hidden ? 0 : terminal.style.padding;
  const width = direction === 'down' ? Math.max(24, size.width + 2 * padding) : size.width + 2 * padding + 16,
    height = direction === 'down' ? size.height + 2 * padding + 16 : Math.max(24, size.height + 2 * padding);
  if (!Number.isFinite(width) || !Number.isFinite(height))
    throw new Error('Non-finite terminal dimensions: ' + terminal.id);
  return { width, height };
}

// Keep the baseline untouched; each alternative changes one placement option.
const PLACEMENT_OPTIONS = {
  default: {},
  relaxed: { 'elk.layered.nodePlacement.favorStraightEdges': 'false' },
  simple: { 'elk.layered.nodePlacement.strategy': 'SIMPLE' },
};

/** Build a fresh compound ELK graph from the routing model. */
export function buildElkGraph(model) {
  const deferred = gridInternalEdges(model);
  const geometry = new Map(
    model.modules.map((module) => [module.id, moduleGeometry(module, model.layout.direction)]),
  );
  const spacing = routingSpacing(model.connections),
    strokeWidth = spacing.stroke,
    extraStroke = spacing.extra,
    profile = LAYOUT_DEFAULTS;
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
      'elk.spacing.edgeNode': String(profile.edgeNode + strokeWidth / 2),
      'elk.layered.spacing.edgeNodeBetweenLayers': String(profile.edgeNode + strokeWidth / 2),
      'elk.spacing.edgeEdge': String(profile.edgeEdge + strokeWidth),
      'elk.layered.spacing.edgeEdgeBetweenLayers': String(profile.edgeEdge + strokeWidth),
    },
    children: model.modules.map((module) => {
      const { width, height, portPoints } = geometry.get(module.id);
      return {
        id: module.id,
        width,
        height,
        layoutOptions: { 'elk.portConstraints': 'FIXED_POS' },
        ports: module.ports.map((port) => ({
          id: `${module.id}.${port.id}`,
          width: 0,
          height: 0,
          x: portPoints[port.id].x,
          y: portPoints[port.id].y,
          layoutOptions: {
            'elk.port.side': portSide(model.layout.direction, port.direction === 'input', port.side),
          },
        })),
      };
    }),
    edges: model.connections
      .filter((c) => c.constraint !== false && !deferred.has(c.id))
      .map((connection) => ({
        id: `@${connection.id}`,
        sources: [ref(connection.source)],
        targets: [ref(connection.target)],
        layoutOptions: { 'elk.layered.priority.direction': connection.feedback ? '0' : '10' },
      })),
  };
  if (model.terminals?.length) {
    Object.assign(graph.layoutOptions, {
      'elk.separateConnectedComponents': 'false',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.layered.crossingMinimization.forceNodeModelOrder': 'true',
    });
    for (const terminal of model.terminals) {
      const { width, height } = terminalGeometry(terminal, model.layout.direction);
      const down = model.layout.direction === 'down',
        first = (terminal.direction === 'input') === (model.layout.direction !== 'left');
      graph.children.push({
        id: terminalNodeId(terminal.id),
        width,
        height,
        layoutOptions: {
          'elk.portConstraints': 'FIXED_POS',
          'elk.layered.layering.layerConstraint': first ? 'FIRST_SEPARATE' : 'LAST_SEPARATE',
        },
        ports: [
          {
            id: ref({ terminal: terminal.id }),
            width: 0,
            height: 0,
            x: down ? width / 2 : terminal.direction === 'input' ? width : 0,
            y: down ? (terminal.direction === 'input' ? height : 0) : height / 2,
            layoutOptions: {
              'elk.port.side': portSide(model.layout.direction, terminal.direction !== 'input'),
            },
          },
        ],
      });
    }
  }
  applyGroups(graph, model);
  budgetContainerSpacing(graph, model);
  return graph;
}
