import { ancestors, descendants } from '../hierarchy.js';
import { textSize, textBounds, moduleGeometry, BLOCK_SIZE_UNIT } from '../geometry.js';

export function groupGeometry(group) {
  const label = textSize(group.label, group.style.label);
  const inset = 18 + group.style.borderWidth;
  const title = label.height + 2 * group.style.label.padding + 12;
  const basic={inset,title,width:Math.max(180,(group.width??0)*BLOCK_SIZE_UNIT.width,label.width+2*group.style.label.padding+2*inset),height:Math.max((group.height??0)*BLOCK_SIZE_UNIT.height,title+2*inset+32)};
  if(group.portMode!=='boundary') return {...basic,top:inset+title,left:inset,right:inset,bottom:inset};
  const ports=group.ports??[], measured=ports.map(port=>({port,...textSize(port.displayName,port.style)}));
  const maxHeight=Math.max(0,...measured.map(item=>item.height+2*item.port.style.padding));
  const lane=direction=>Math.max(0,...measured.filter(item=>item.port.direction===direction).map(item=>item.width+2*item.port.style.padding));
  const top=inset+title+maxHeight+12,bottom=inset+12;
  const left=inset+lane('input')+24,right=inset+lane('output')+24;
  const column=direction=>measured.filter(item=>item.port.direction===direction).reduce((sum,item)=>sum+2*(item.height+2*item.port.style.padding+6)+12,0);
  return {...basic,top,bottom,left,right,width:Math.max(basic.width,left+right+140),height:Math.max(basic.height,top+bottom+Math.max(column('input'),column('output')))};
}

export function applyGroups(graph, model) {
  if (!model.groups?.length) return;
  graph.layoutOptions['elk.hierarchyHandling'] = 'INCLUDE_CHILDREN';
  const nodes = new Map(graph.children.map(node => [node.id, node]));
  const members = new Set(model.groups.flatMap(group => group.members));
  const leaves = graph.children;
  for (const group of model.groups) {
    if (group.collapsed) {
      const geometry=moduleGeometry(group);
      nodes.set(group.id,{id:group.id,width:geometry.width,height:geometry.height+(group.stackLayers??0)*6,
        layoutOptions:{'elk.portConstraints':'FIXED_POS'},
        ports:group.ports.map(port=>({id:group.id+'.'+port.id,width:0,height:0,
          x:port.direction==='input'?0:geometry.width,y:geometry.rowCenters[port.order],
          layoutOptions:{'elk.port.side':port.direction==='input'?'WEST':'EAST'},
        })),
      });
      continue;
    }
    const { top,left,right,bottom,width,height } = groupGeometry(group);
    nodes.set(group.id, { id: group.id, width, height,
      layoutOptions: {
        'elk.algorithm': 'layered', 'elk.direction': model.layout.direction.toUpperCase(),
        'elk.padding': `[top=${top},left=${left},bottom=${bottom},right=${right}]`,
        'elk.nodeSize.constraints': '[MINIMUM_SIZE]', 'elk.nodeSize.minimum': `(${width},${height})`,
        'elk.spacing.nodeNode': graph.layoutOptions['elk.spacing.nodeNode'],
        'elk.layered.spacing.nodeNodeBetweenLayers': graph.layoutOptions['elk.layered.spacing.nodeNodeBetweenLayers'],
      },
      ...(group.portMode==='boundary'?{
        ports:group.ports.map(port=>({id:group.id+'.'+port.id,width:0,height:2*(textSize(port.displayName,port.style).height+2*port.style.padding+6),
          layoutOptions:{'elk.port.side':port.direction==='input'?'WEST':'EAST','elk.port.index':String(port.direction==='input'?group.ports.length-1-port.order:port.order)}})),
      }:{}),
    });
    if(group.portMode==='boundary') Object.assign(nodes.get(group.id).layoutOptions,{
      'elk.portConstraints':'FIXED_ORDER','elk.spacing.portPort':'12',
      'elk.spacing.portsSurrounding':`[top=${top},left=0,bottom=${bottom},right=0]`,
      'elk.nodeSize.constraints':'[MINIMUM_SIZE,PORTS]',
    });
  }
  for (const group of model.groups) if(!group.collapsed) nodes.get(group.id).children = group.members.map(id => nodes.get(id));
  if(model.groups.some(group=>group.portMode==='boundary')) {
    const refs=new Map(model.connections.map(edge=>['@'+edge.id,edge]));
    graph.edges=graph.edges.filter(edge=>{
      const ref=refs.get(edge.id);
      if(ref.insideSelfLoop) {
        // A zero-size relay avoids ELK inside-self-loop port reordering. It is
        // layout-only; absoluteGraph merges both halves back to one real edge.
        const owner=nodes.get(ref.scope),id='@relay:'+ref.id;
        owner.children.push({id,width:0,height:0,layoutOptions:{'elk.portConstraints':'FIXED_POS'},ports:[
          {id:id+'.in',width:0,height:0,x:0,y:0,layoutOptions:{'elk.port.side':'WEST'}},
          {id:id+'.out',width:0,height:0,x:0,y:0,layoutOptions:{'elk.port.side':'EAST'}},
        ]});
        owner.edges??=[];
        owner.edges.push({...edge,id:edge.id+'~in',targets:[id+'.in']},{...edge,id:edge.id+'~out',sources:[id+'.out'],labels:[]});
        return false;
      }
      if(ref.scope) {const owner=nodes.get(ref.scope);owner.edges??=[];owner.edges.push(edge);return false;}
      return true;
    });
  }
  graph.children = [...leaves, ...model.groups.map(group => nodes.get(group.id))].filter(node => !members.has(node.id));
}

/** ELK may keep an internal edge at root while giving it a group-local container. */
export function absoluteGraph(graph) {
  const nodes = new Map([[graph.id, { x: 0, y: 0 }]]);
  const rawEdges = [];
  function walk(parent, x, y) {
    for (const edge of parent.edges ?? []) rawEdges.push({ edge, container: edge.container ?? parent.id });
    for (const node of parent.children ?? []) {
      const placed = { ...node, x: x + node.x, y: y + node.y };
      nodes.set(node.id, placed);
      walk(node, placed.x, placed.y);
    }
  }
  walk(graph, 0, 0);
  const edges = new Map(rawEdges.map(({ edge, container }) => {
    const offset = nodes.get(container);
    if (!offset) throw new Error('Unknown edge coordinate container: ' + container);
    const point = p => ({ x: p.x + offset.x, y: p.y + offset.y });
    return [edge.id.slice(1), { ...edge, labels: edge.labels?.map(label => ({ ...label, ...point(label) })), sections: edge.sections?.map(section => ({ ...section,
      startPoint: point(section.startPoint), endPoint: point(section.endPoint), bendPoints: section.bendPoints?.map(point) })) }];
  }));
  for(const [id,first] of [...edges]) if(id.endsWith('~in')) {
    const original=id.slice(0,-3),last=edges.get(original+'~out');
    if(!last) throw new Error('Missing group pass-through route');
    const sections=[...first.sections,...last.sections].map(section=>({...section,bendPoints:[...(section.bendPoints??[])]}));
    const joined=[];
    for(const section of sections) {
      const previous=joined.at(-1);
      if(previous&&Math.abs(previous.endPoint.x-section.startPoint.x)<1e-6&&Math.abs(previous.endPoint.y-section.startPoint.y)<1e-6) {
        previous.bendPoints.push(previous.endPoint,...section.bendPoints);previous.endPoint=section.endPoint;
      } else joined.push(section);
    }
    edges.set(original,{...first,id:'@'+original,sections:joined});edges.delete(id);edges.delete(original+'~out');
  }
  return { nodes, edges };
}

export function groupResults(model, nodes) {
  return [...(model.groups ?? [])].sort((a, b) => ancestors(model, a.id).length - ancestors(model, b.id).length).map(group => {
    const node = nodes.get(group.id);
    const { inset, title } = groupGeometry(group);
    const geometry=group.collapsed?moduleGeometry(group):null;
    const labelPosition = geometry ? {x:node.x+node.width/2,y:node.y+geometry.titleY,anchor:'middle'} : { x: node.x + inset + group.style.label.padding, y: node.y + inset + title / 2, anchor: 'start' };
    return { ...structuredClone(group), blockIds: [...descendants(model, group.id)].filter(id => model.modules.some(module => module.id === id)), depth: ancestors(model, group.id).length, x: node.x, y: node.y, width: node.width, height: node.height,
      labelPosition, labelBounds: textBounds(group.label, labelPosition, group.style.label),
      ...(group.stackLayers!==undefined?{faceHeight:geometry.height}:{}),
      ports:group.portMode==='boundary' ? group.ports.map(port=>{
        const placed=node.ports.find(item=>item.id===group.id+'.'+port.id);
        const x=node.x+placed.x+(placed.width??0)/2,y=node.y+placed.y+(placed.height??0)/2;
        const size=textSize(port.displayName,port.style);
        const offset=(geometry?.portInset??8)+port.style.padding;
        const labelPosition={x:x+(port.direction==='input'?offset:-offset),y:geometry?y:y-size.height/2-port.style.padding-6,anchor:port.direction==='input'?'start':'end'};
        return {...structuredClone(port),x,y,labelPosition,labelBounds:textBounds(port.displayName,labelPosition,port.style)};
      }):[],
    };
  });
}

/** Compound non-flow ports can ignore FIXED_ORDER in ELK (notably LEFT).
 * Repair only affected columns, with short orthogonal joins beside the wall.
 * Group padding reserves these lanes, so internal joins stay outside children.
 */
export function preserveGroupPortOrder(groups, connections) {
  const moved=new Map();
  for(const group of groups) for(const direction of ['input','output']) {
    if(group.collapsed) continue;
    const ports=group.ports.filter(port=>port.direction===direction);
    if(ports.every((port,i)=>!i||port.y>ports[i-1].y)) continue;
    const geometry=groupGeometry(group);
    const half=port=>textSize(port.displayName,port.style).height+2*port.style.padding+6;
    const available=group.height-geometry.top-geometry.bottom;
    const free=available-ports.reduce((sum,port)=>sum+2*half(port),0);
    const gap=Math.max(12,free/(ports.length+1));
    let cursor=group.y+geometry.top+Math.max(0,(free-gap*(ports.length-1))/2);
    for(const port of ports) {
      const previous={x:port.x,y:port.y};
      const y=cursor+half(port),dy=y-port.y;
      port.y=y;port.labelPosition.y+=dy;port.labelBounds.y+=dy;
      moved.set(group.id+'.'+port.id,{previous,port});
      cursor=y+half(port)+gap;
    }
  }
  const same=(a,b)=>Math.abs(a.x-b.x)<1e-6&&Math.abs(a.y-b.y)<1e-6;
  for(const edge of connections) for(const [endpoint,start] of [[edge.source,true],[edge.target,false]]) {
    const move=moved.get(endpoint.moduleId+'.'+endpoint.portId);if(!move) continue;
    for(const section of edge.sections) {
      const points=start?section.points:[...section.points].reverse();
      if(!same(points[0],move.previous)) continue;
      const next=points[1];
      if(Math.abs(next.y-move.previous.y)>1e-6||Math.abs(next.x-move.previous.x)<1e-6)
        throw new Error('Expected horizontal group port departure');
      const x=move.previous.x+Math.sign(next.x-move.previous.x)*Math.min(6,Math.abs(next.x-move.previous.x)/2);
      const joined=[{x:move.port.x,y:move.port.y},{x,y:move.port.y},{x,y:move.previous.y},...points.slice(1)];
      section.points=start?joined:joined.reverse();
    }
  }
}
