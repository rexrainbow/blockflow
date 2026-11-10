import { placeEdgeLabels, connectionLabels } from './edge-labels.js';
import ELK from 'elkjs/lib/elk.bundled.js';
import { applyGroups, absoluteGraph, groupResults, preserveGroupPortOrder } from './groups.js';
import { routeOuterFeedback } from './outer-feedback.js';
import { moduleGeometry, textBounds, textSize } from '../geometry.js';
import { connectionStyle } from '../styles.js';
import { visibleModel } from './visibility.js';
import { scopeModel } from './scope.js';
import { applyConnectionArrows } from './arrows.js';
import {portSide} from '../direction.js';
import {arrangeGrids,routeFixed} from './fixed.js';
import {TEXT_STYLE} from '../styles.js';
import {signalModel,finishSignals,receiverLabels} from './signals.js';
import { adjustPorts } from './port-adjustment.js';
import { alignReceivers } from './receiver-layout.js';
import { alignTerminals } from './terminal-alignment.js';

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

async function toLayoutResult(laidOut, model, elk) {
    const { nodes, edges } = absoluteGraph(laidOut);
    let groups = groupResults(model, nodes);
    let terminals=(model.terminals??[]).map(terminal=>{
      const node=nodes.get(terminalNodeId(terminal.id));
      const down=model.layout.direction==='down',size=textSize(terminal.displayName,terminal.style),padding=terminal.style.hidden?0:terminal.style.padding;
      const labelPosition=down?{x:node.x+node.width/2,y:node.y+padding+size.height/2+(terminal.direction==='input'?0:16),anchor:'middle'}:{x:node.x+padding+(terminal.direction==='input'?0:16),y:node.y+node.height/2,anchor:'start'};
      return {...structuredClone(terminal),x:node.x,y:node.y,width:node.width,height:node.height,bitWidth:terminal.width,
        anchor:down?{x:node.x+node.width/2,y:node.y+(terminal.direction==='input'?node.height:0)}:{x:node.x+(terminal.direction==='input'?node.width:0),y:node.y+node.height/2},
        labelPosition,labelBounds:textBounds(terminal.displayName,labelPosition,terminal.style)};
    });
    let modules = model.modules.map(module => {
      const node = nodes.get(module.id);
      const ports = new Map(node.ports.map(port => [port.id, port]));
      const geometry = moduleGeometry(module, model.layout.direction);
      const labelPosition = { x: node.x + geometry.titleX, y: node.y + geometry.titleY, anchor: 'middle' };
      return {
        id: module.id, label: module.label,
        ...(module.type?{type:module.type}:{}),
        ...(module._signalSize?{_signalSize:module._signalSize}:{}),
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
            id: port.id, direction: port.direction, side:port.side, displayName: port.displayName, width: port.width, x, y,
            style: structuredClone(port.style), labelPosition,
            labelBounds: visible?textBounds(port.displayName, labelPosition, port.style):{x,y,width:0,height:0},
          };
        }),
      };
    });
    const anchorMap=new Map([...modules,...groups].flatMap(n=>n.ports.map(p=>[n.id+'.'+p.id,p])));
    const anchor=e=>e.terminal!==undefined?terminals.find(t=>t.id===e.terminal).anchor:anchorMap.get(e.moduleId+'.'+e.portId);
    let connections = model.connections.map(connection => {
      const edge = edges.get(connection.id)??(connection.constraint===false?{sections:[{startPoint:anchor(connection.source),endPoint:anchor(connection.target)}]}:undefined);
      if (!edge?.sections?.length) throw new Error(`Missing route: ${connection.id}`);
      return {
        id: connection.id, source: structuredClone(connection.originalSource??connection.source), target: structuredClone(connection.originalTarget??connection.target),
        ...(connection.netId?{netId:connection.netId,connectionIndex:connection.connectionIndex,branchIndex:connection.branchIndex,netStyle:structuredClone(connection.netStyle)}:{}),
        ...(connection.originalSource?{routingSource:structuredClone(connection.source),routingTarget:structuredClone(connection.target)}:{}), width: connection.width, feedback: connection.feedback,
        style: structuredClone(connection.style),
        ...(connection.direction?{direction:connection.direction}:{}),...(connection.constraint!==undefined?{constraint:connection.constraint}:{}),
        ...(connection.scope!==undefined?{scope:connection.scope}:{}),
        ...(connection.label !== undefined ? { label: connection.label,
        } : {}),
        sections: edge.sections.map(section => ({
          points: [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map(point => ({ x: point.x, y: point.y })),
        })),
      };
    });

    preserveGroupPortOrder(groups, connections, model.layout.direction);
    const grid=(!model.rootGroupId&&model.layout.type==='grid')||model.groups.some(g=>!g.collapsed&&g.layout?.type==='grid');
    if(grid){await arrangeGrids({modules,groups,terminals,connections},model,elk);routeFixed({modules,groups,terminals,connections},model);}
    else if(model.connections.some(e=>e.constraint===false))routeFixed({modules,groups,terminals,connections},model,true);
    const adjusted={modules,groups,terminals,connections};alignTerminals(adjusted,model);alignReceivers(adjusted,model);adjustPorts(adjusted,model);
    ({modules,groups,terminals,connections}=adjusted);
    if (model.layout?.feedbackRouting === 'outer') routeOuterFeedback({ modules, groups, connections }, model);
    const routed={modules,groups,connections};finishSignals(routed,model);
    ({modules,groups,connections}=routed);
    applyConnectionArrows(connections);
    const warnings = placeEdgeLabels({ modules, groups, terminals, connections });
    const allPoints = [
      ...connections.flatMap(edge=>[...(edge.arrow?.points??[]),...(edge.startArrow?.points??[])]),
      ...connections.flatMap(edge => connectionLabels(edge).flatMap(label => [label.bounds,
        { x: label.bounds.x + label.bounds.width, y: label.bounds.y + label.bounds.height }, ...(label.leader??[])])),
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
      for(const a of [connection.arrow,connection.startArrow])if(a){a.points.forEach(shift);shift(a.bounds);}
      if (connection.labelInstances?.length) {
        for(const label of connection.labelInstances) {shift(label.position);shift(label.bounds);label.leader?.forEach(shift);}
        connection.labelPosition=connection.labelInstances[0].position;connection.labelBounds=connection.labelInstances[0].bounds;
      } else if (connection.labelPosition) { shift(connection.labelPosition); shift(connection.labelBounds); }
    }
    const result = { width, height, modules, connections, ...(terminals.length?{terminals}:{}), ...(warnings.length ? { warnings } : {}), ...(groups.length ? { groups } : {}) };
    if(model.diagram.caption!==undefined){
      const style={...TEXT_STYLE,...model.diagram.style.caption},size=textSize(model.diagram.caption,style),pad=style.hidden?0:style.padding;
      const labelPosition={x:pad,y:result.height+(style.hidden?0:12+pad+size.height/2),anchor:'start'},labelBounds=textBounds(model.diagram.caption,labelPosition,style);
      if(![labelBounds.x,labelBounds.y,labelBounds.width,labelBounds.height,labelBounds.y+labelBounds.height].every(Number.isFinite))throw new Error('Non-finite caption bounds');
      result.caption={text:model.diagram.caption,style,labelPosition,labelBounds};
      if(!style.hidden){result.width=Math.max(result.width,labelBounds.width);result.height=labelBounds.y+labelBounds.height;}
    }
    return result;
}

/** ELK produces placement/routes; an optional AABB pass replaces feedback routes. */
async function layoutPass(model, receivers) {
  try {
    model = signalModel(model, receivers);
    const geometry = new Map(model.modules.map(module => [module.id, moduleGeometry(module, model.layout.direction)]));
    const styleWidth=s=>(s.endArrow==='triangle'||s.startArrow==='triangle')?Math.max(8,s.strokeWidth*3):s.strokeWidth;
    const visualWidth=c=>Math.max(styleWidth(c.style),c.netStyle?styleWidth(c.netStyle):0);
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
            layoutOptions: { 'elk.port.side': portSide(model.layout.direction,port.direction==='input',port.side) },
          })),
        };
      }),
      edges: model.connections.filter(c=>c.constraint!==false).map(connection => ({
        id: `@${connection.id}`, sources: [ref(connection.source)], targets: [ref(connection.target)],
        layoutOptions: { 'elk.layered.priority.direction': connection.feedback ? '0' : '10' },
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
    const result = await toLayoutResult(await elk.layout(graph), model, elk);
    return model.rootGroupId ? {...result,rootGroupId:model.rootGroupId} : result;
  } catch (cause) {
    throw new DiagramLayoutError(`Layout failed: ${cause.message}`, { cause });
  }
}

export async function layoutDiagram(model, options = {}) {
  try {
    model = visibleModel(scopeModel(model, options.rootGroupId));
    const selected = receiverLabels(model);
    const first = await layoutPass(model, selected);
    const final = receiverLabels(model, first);
    return await ([...final].some(id => !selected.has(id)) ? layoutPass(model, final) : first);
  } catch(cause) {
    if(cause instanceof DiagramLayoutError)throw cause;
    throw new DiagramLayoutError(`Layout failed: ${cause.message}`,{cause});
  }
}
