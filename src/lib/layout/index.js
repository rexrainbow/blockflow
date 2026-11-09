import { edgeLabelSize, placeEdgeLabels } from './edge-labels.js';
import ELK from 'elkjs/lib/elk.bundled.js';
import { applyGroups, absoluteGraph, groupResults, preserveGroupPortOrder } from './groups.js';
import { routeOuterFeedback } from './outer-feedback.js';
import { moduleGeometry, textBounds, textSize } from '../geometry.js';
import { connectionStyle } from '../styles.js';
import { visibleModel } from './visibility.js';
import { scopeModel } from './scope.js';
import { connectionArrow } from './arrows.js';
import {portSide} from '../direction.js';

export class DiagramLayoutError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'DiagramLayoutError';
  }
}

const terminalNodeId = id => `@terminal:${id}`;
const ref = endpoint => endpoint.terminal !== undefined ? `${terminalNodeId(endpoint.terminal)}.anchor` : `${endpoint.moduleId}.${endpoint.portId}`;
function terminalGeometry(terminal, direction) {
  const size=textSize(terminal.displayName,terminal.style), padding=terminal.style.hidden?0:terminal.style.padding;
  const width=direction==='down'?Math.max(24,size.width+2*padding):size.width+2*padding+16, height=direction==='down'?size.height+2*padding+16:Math.max(24,size.height+2*padding);
  if(!Number.isFinite(width)||!Number.isFinite(height)) throw new Error('Non-finite terminal dimensions: '+terminal.id);
  return {width,height};
}

// Keep the baseline untouched; each alternative changes one placement option.
const PLACEMENT_OPTIONS = {
  default: {},
  relaxed: { 'elk.layered.nodePlacement.favorStraightEdges': 'false' },
  simple: { 'elk.layered.nodePlacement.strategy': 'SIMPLE' },
};

function toLayoutResult(laidOut, model) {
    const { nodes, edges } = absoluteGraph(laidOut);
    const groups = groupResults(model, nodes);
    const terminals=(model.terminals??[]).map(terminal=>{
      const node=nodes.get(terminalNodeId(terminal.id));
      const down=model.layout.direction==='down',size=textSize(terminal.displayName,terminal.style),padding=terminal.style.hidden?0:terminal.style.padding;
      const labelPosition=down?{x:node.x+node.width/2,y:node.y+padding+size.height/2+(terminal.direction==='input'?0:16),anchor:'middle'}:{x:node.x+padding+(terminal.direction==='input'?0:16),y:node.y+node.height/2,anchor:'start'};
      return {...structuredClone(terminal),x:node.x,y:node.y,width:node.width,height:node.height,bitWidth:terminal.width,
        anchor:down?{x:node.x+node.width/2,y:node.y+(terminal.direction==='input'?node.height:0)}:{x:node.x+(terminal.direction==='input'?node.width:0),y:node.y+node.height/2},
        labelPosition,labelBounds:textBounds(terminal.displayName,labelPosition,terminal.style)};
    });
    const modules = model.modules.map(module => {
      const node = nodes.get(module.id);
      const ports = new Map(node.ports.map(port => [port.id, port]));
      const geometry = moduleGeometry(module, model.layout.direction);
      const labelPosition = { x: node.x + geometry.titleX, y: node.y + geometry.titleY, anchor: 'middle' };
      return {
        id: module.id, label: module.label,
        ...(module.type?{type:module.type}:{}),
        style: structuredClone(module.style),
        ...(geometry.body?{body:structuredClone(geometry.body)}:{}),
        x: node.x, y: node.y, width: node.width, height: node.height,
        labelPosition,
        labelBounds: textBounds(module.label, labelPosition, module.style.label),
        ports: module.ports.map(port => {
          const placed = ports.get(`${module.id}.${port.id}`);
          const x = node.x + placed.x;
          const y = node.y + placed.y;
          const visible=!port.style.hidden;
          const inset = (port.direction==='output'?geometry.outputLabelInset??geometry.portInset:geometry.portInset) + (visible?port.style.padding:0);
          const local=geometry.portLabels?.[port.id];
          const labelPosition = local?{...local,x:node.x+local.x,y:node.y+local.y}:{ x: x + (port.direction === 'input' ? inset : -inset), y, anchor: port.direction === 'input' ? 'start' : 'end' };
          return {
            id: port.id, direction: port.direction, displayName: port.displayName, width: port.width, x, y,
            style: structuredClone(port.style), labelPosition,
            labelBounds: visible?textBounds(port.displayName, labelPosition, port.style):{x,y,width:0,height:0},
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

    preserveGroupPortOrder(groups, connections, model.layout.direction);
    if (model.layout?.feedbackRouting === 'outer') routeOuterFeedback({ modules, groups, connections }, model);
    for(const edge of connections) {const arrow=connectionArrow(edge);if(arrow) edge.arrow=arrow;}
    const warnings = placeEdgeLabels({ modules, groups, terminals, connections });
    const allPoints = [
      ...connections.flatMap(edge=>edge.arrow?.points??[]),
      ...connections.filter(edge => edge.labelBounds).flatMap(edge => [edge.labelBounds,
        { x: edge.labelBounds.x + edge.labelBounds.width, y: edge.labelBounds.y + edge.labelBounds.height }]),
      ...[...modules, ...groups, ...terminals].flatMap(module => [{ x: module.x, y: module.y }, { x: module.x + module.width, y: module.y + module.height }]),
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
    for(const terminal of terminals) {shift(terminal);shift(terminal.anchor);shift(terminal.labelPosition);shift(terminal.labelBounds);}
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
      if(connection.arrow) {connection.arrow.points.forEach(shift);shift(connection.arrow.bounds);}
      if (connection.labelPosition) { shift(connection.labelPosition); shift(connection.labelBounds); }
    }
    const result = { width, height, modules, connections, ...(terminals.length?{terminals}:{}), ...(warnings.length ? { warnings } : {}), ...(groups.length ? { groups } : {}) };
    return result;
}

/** ELK produces placement/routes; an optional AABB pass replaces feedback routes. */
export async function layoutDiagram(model, options = {}) {
  try {
    model = scopeModel(model, options.rootGroupId);
    model = visibleModel(model);
    const geometry = new Map(model.modules.map(module => [module.id, moduleGeometry(module, model.layout.direction)]));
    const visualWidth=c=>c.style.endArrow==='triangle'?Math.max(8,c.style.strokeWidth*3):c.style.strokeWidth;
    const strokeWidth = Math.max(0, ...model.connections.map(visualWidth));
    const extraStroke = Math.max(0, ...model.connections.map(c => visualWidth(c) - connectionStyle(c.width).strokeWidth));
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
        const { width, height, portPoints } = geometry.get(module.id);
        return {
          id: module.id, width, height,
          layoutOptions: { 'elk.portConstraints': 'FIXED_POS' },
          ports: module.ports.map(port => ({
            id: `${module.id}.${port.id}`, width: 0, height: 0,
            x: portPoints[port.id].x,
            y: portPoints[port.id].y,
            layoutOptions: { 'elk.port.side': portSide(model.layout.direction,port.direction==='input') },
          })),
        };
      }),
      edges: model.connections.map(connection => ({
        id: `@${connection.id}`, sources: [ref(connection.source)], targets: [ref(connection.target)],
        layoutOptions: { 'elk.layered.priority.direction': connection.feedback ? '0' : '10' },
        ...(connection.label !== undefined && !connection.style.label.hidden ? { labels: [{ id: '@label_' + connection.id, text: connection.label,
          width: edgeLabelSize(connection).width + 16, height: edgeLabelSize(connection).height + 12,
          layoutOptions: { 'elk.edgeLabels.placement': 'CENTER', 'elk.edgeLabels.inline': 'false' },
        }] } : {}),
      })),
    };
    if(model.terminals?.length) {
      Object.assign(graph.layoutOptions,{
        'elk.separateConnectedComponents':'false',
        'elk.layered.considerModelOrder.strategy':'NODES_AND_EDGES',
        'elk.layered.crossingMinimization.forceNodeModelOrder':'true',
      });
      for(const terminal of model.terminals) {
        const {width,height}=terminalGeometry(terminal,model.layout.direction);
        const down=model.layout.direction==='down',first=(terminal.direction==='input')===(model.layout.direction!=='left');
        graph.children.push({id:terminalNodeId(terminal.id),width,height,
          layoutOptions:{'elk.portConstraints':'FIXED_POS','elk.layered.layering.layerConstraint':first?'FIRST_SEPARATE':'LAST_SEPARATE'},
          ports:[{id:ref({terminal:terminal.id}),width:0,height:0,x:down?width/2:terminal.direction==='input'?width:0,y:down?(terminal.direction==='input'?height:0):height/2,
            layoutOptions:{'elk.port.side':portSide(model.layout.direction,terminal.direction!=='input')}}]});
      }
    }
    applyGroups(graph, model);
    const elk = new ELK();
    let best;
    // At most two spacing retries; unlabeled diagrams retain the original pass.
    for (let attempt = 0; attempt < 3; attempt++) {
      const candidate = structuredClone(graph);
      const increase = attempt * Math.max(40, ...model.connections.filter(edge => edge.label !== undefined && !edge.style.label.hidden).map(edge => edgeLabelSize(edge).width / 2));
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
