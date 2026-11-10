import { ancestors, descendants } from '../hierarchy.js';
import {portSide} from '../direction.js';
import {needsSides,defaultSide} from '../port-sides.js';
import { textSize, textBounds, moduleGeometry, BLOCK_SIZE_UNIT } from '../geometry.js';

export function groupGeometry(group, direction = 'right') {
  if(group._signalWrapper)return {inset:0,title:0,top:0,left:0,right:0,bottom:0,width:0,height:0};
  if(group.portMode==='boundary'&&needsSides(group,direction)){
    const inset=18+group.style.borderWidth,t=textSize(group.label,group.style.label),title=group.style.label.hidden?0:t.height+2*group.style.label.padding+12;
    const size=p=>{const v=textSize(p.displayName,p.style),pad=p.style.hidden?0:p.style.padding;return {width:v.width+2*pad,height:v.height+2*pad};};
    const list=side=>group.ports.filter(p=>p.side===side),lane=(side,axis)=>Math.max(0,...list(side).map(p=>size(p)[axis]));
    const span=(side,axis)=>list(side).reduce((n,p)=>n+2*(size(p)[axis]+6)+12,0);
    const inputHeight=lane('top','height'),left=inset+lane('left','width')+24+(list('top').length?t.width+2*inset:0),right=inset+lane('right','width')+24,top=inset+inputHeight+12+title+12,bottom=inset+lane('bottom','height')+24;
    return {inset,title,inputHeight,left,right,top,bottom,width:Math.max(180,(group.width??0)*140,left+right+Math.max(span('top','width'),span('bottom','width'),140),t.width+2*inset),height:Math.max((group.height??0)*84,top+bottom+Math.max(span('left','height'),span('right','height'),84))};
  }
  if(direction==='down') {
    const inset=18+group.style.borderWidth,label=textSize(group.label,group.style.label),title=group.style.label.hidden?0:label.height+2*group.style.label.padding+12;
    const size=p=>{const t=textSize(p.displayName,p.style),pad=p.style.hidden?0:p.style.padding;return {width:t.width+2*pad,height:t.height+2*pad};};
    const ports=group.ports??[];
    const lane=side=>Math.max(0,...ports.filter(p=>p.direction===side).map(p=>size(p).height));
    const column=side=>ports.filter(p=>p.direction===side).reduce((sum,p)=>sum+2*(size(p).width+6)+12,0);
    const inputHeight=lane('input'),outputHeight=lane('output');
    const top=inset+inputHeight+12+title+12,bottom=inset+outputHeight+24,left=Math.max(inset+12,label.width+2*(group.style.label.hidden?0:group.style.label.padding)+2*inset),right=inset+12;
    return {inset,title,inputHeight,top,bottom,left,right,width:Math.max(180,(group.width??0)*BLOCK_SIZE_UNIT.width,label.width+2*(group.style.label.hidden?0:group.style.label.padding)+2*inset,left+right+Math.max(column('input'),column('output'))),height:Math.max((group.height??0)*BLOCK_SIZE_UNIT.height,top+bottom+84)};
  }
  const label = textSize(group.label, group.style.label);
  const inset = 18 + group.style.borderWidth;
  const title = group.style.label.hidden?0:label.height + 2 * group.style.label.padding + 12;
  const basic={inset,title,width:Math.max(180,(group.width??0)*BLOCK_SIZE_UNIT.width,label.width+2*(group.style.label.hidden?0:group.style.label.padding)+2*inset),height:Math.max((group.height??0)*BLOCK_SIZE_UNIT.height,title+2*inset+32)};
  if(group.portMode!=='boundary') return {...basic,top:inset+title,left:inset,right:inset,bottom:inset};
  const ports=group.ports??[], measured=ports.map(port=>({port,...(!port.style.hidden?textSize(port.displayName,port.style):{width:0,height:0})}));
  const maxHeight=Math.max(0,...measured.map(item=>item.height+(!item.port.style.hidden?2*item.port.style.padding:0)));
  const lane=direction=>Math.max(0,...measured.filter(item=>item.port.direction===direction).map(item=>item.width+(!item.port.style.hidden?2*item.port.style.padding:0)));
  const top=inset+title+maxHeight+12,bottom=inset+12;
  const left=inset+lane('input')+24,right=inset+lane('output')+24;
  const column=direction=>measured.filter(item=>item.port.direction===direction).reduce((sum,item)=>sum+2*(item.height+(!item.port.style.hidden?2*item.port.style.padding:0)+6)+12,0);
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
      const geometry=moduleGeometry(group, model.layout.direction);
      nodes.set(group.id,{id:group.id,width:geometry.width,height:geometry.height+(group.stackLayers??0)*6,
        layoutOptions:{'elk.portConstraints':'FIXED_POS'},
        ports:group.ports.map(port=>({id:group.id+'.'+port.id,width:0,height:0,
          x:geometry.portPoints[port.id].x,y:geometry.portPoints[port.id].y+(model.layout.direction==='down'&&port.direction==='output'?(group.stackLayers??0)*6:0),
          layoutOptions:{'elk.port.side':portSide(model.layout.direction,port.direction==='input',port.side)},
        })),
      });
      continue;
    }
    const { top,left,right,bottom,width,height } = groupGeometry(group, model.layout.direction);
    nodes.set(group.id, { id: group.id, width, height,
      layoutOptions: {
        'elk.algorithm': 'layered', 'elk.direction': (group._signalDirection??model.layout.direction).toUpperCase(),
        'elk.padding': `[top=${top},left=${left},bottom=${bottom},right=${right}]`,
        'elk.nodeSize.constraints': '[MINIMUM_SIZE]', 'elk.nodeSize.minimum': `(${width},${height})`,
        'elk.spacing.nodeNode': group._signalWrapper?'8':graph.layoutOptions['elk.spacing.nodeNode'],
        'elk.layered.spacing.nodeNodeBetweenLayers': group._signalWrapper?'8':graph.layoutOptions['elk.layered.spacing.nodeNodeBetweenLayers'],
      },
      ...(group.portMode==='boundary'?{
        ports:group.ports.map(port=>({id:group.id+'.'+port.id,width:['top','bottom'].includes(port.side)?2*((!port.style.hidden?textSize(port.displayName,port.style).width+2*port.style.padding:0)+6):0,height:['top','bottom'].includes(port.side)?0:2*((!port.style.hidden?textSize(port.displayName,port.style).height+2*port.style.padding:0)+6),
          layoutOptions:{'elk.port.side':portSide(model.layout.direction,port.direction==='input',port.side),'elk.port.index':String(['top','right'].includes(port.side)?group.ports.filter(p=>p.side===port.side).indexOf(port):group.ports.length-1-group.ports.filter(p=>p.side===port.side).indexOf(port))}})),
      }:{}),
    });
    if(group.portMode==='boundary') Object.assign(nodes.get(group.id).layoutOptions,{
      'elk.portConstraints':'FIXED_ORDER','elk.spacing.portPort':'12',
      'elk.spacing.portsSurrounding':model.layout.direction==='down'?`[top=0,left=${left},bottom=0,right=${right}]`:`[top=${top},left=0,bottom=${bottom},right=0]`,
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
          {id:id+'.in',width:0,height:0,x:0,y:0,layoutOptions:{'elk.port.side':portSide(model.layout.direction,true)}},
          {id:id+'.out',width:0,height:0,x:0,y:0,layoutOptions:{'elk.port.side':portSide(model.layout.direction,false)}},
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
    const { inset, title, inputHeight=0 } = groupGeometry(group, model.layout.direction);
    const geometry=group.collapsed?moduleGeometry(group, model.layout.direction):null;
    const labelPosition = geometry ? {x:node.x+geometry.titleX,y:node.y+geometry.titleY,anchor:'middle'} : { x: node.x + inset + (group.style.label.hidden?0:group.style.label.padding), y: node.y + inset + title / 2 + (model.layout.direction==='down'?inputHeight+12:0), anchor: 'start' };
    return { ...structuredClone(group), blockIds: [...descendants(model, group.id)].filter(id => model.modules.some(module => module.id === id)), depth: ancestors(model, group.id).length, x: node.x, y: node.y, width: node.width, height: node.height,
      labelPosition, labelBounds: textBounds(group.label, labelPosition, group.style.label),
      ...(group.stackLayers!==undefined?{faceHeight:geometry.height}:{}),
      ports:group.portMode==='boundary' ? group.ports.map(port=>{
        const placed=node.ports.find(item=>item.id===group.id+'.'+port.id);
        const x=node.x+placed.x+(placed.width??0)/2,y=node.y+placed.y+(placed.height??0)/2;
        const size=textSize(port.displayName,port.style);
        const visible=!port.style.hidden;
        const offset=(geometry?.portInset??8)+(visible?port.style.padding:0);
        const local=geometry?.portLabels?.[port.id];
        const side=port.side??defaultSide(port,model.layout.direction),horizontal=['top','bottom'].includes(side);
        const labelPosition=local?{...local,x:node.x+local.x,y:node.y+local.y}:horizontal?{x:x+(visible?8+size.width/2+port.style.padding:0),y:y+(side==='top'?1:-1)*(8+(visible?size.height/2+port.style.padding:0)),anchor:'middle'}:{x:x+(side==='left'?offset:-offset),y:geometry||!visible?y:y-size.height/2-port.style.padding-6,anchor:side==='left'?'start':'end'};
        return {...structuredClone(port),x,y,labelPosition,labelBounds:visible?textBounds(port.displayName,labelPosition,port.style):{x,y,width:0,height:0}};
      }):[],
    };
  });
}

/** Compound non-flow ports can ignore FIXED_ORDER in ELK (notably LEFT).
 * Repair only affected columns, with short orthogonal joins beside the wall.
 * Group padding reserves these lanes, so internal joins stay outside children.
 */
export function preserveGroupPortOrder(groups, connections, flow = 'right') {
  const moved=new Map();
  for(const group of groups) for(const side of ['left','right','top','bottom']) {
    const down=['top','bottom'].includes(side),axis=down?'x':'y',cross=down?'y':'x';
    if(group.collapsed) continue;
    const ports=group.ports.filter(port=>(port.side??defaultSide(port,flow))===side);
    if(ports.every((port,i)=>!i||port[axis]>ports[i-1][axis])) continue;
    const geometry=groupGeometry(group,flow);
    const half=port=>(!port.style.hidden?textSize(port.displayName,port.style)[down?'width':'height']+2*port.style.padding:0)+6;
    const leading=geometry[down?'left':'top'],trailing=geometry[down?'right':'bottom'];
    const free=group[down?'width':'height']-leading-trailing-ports.reduce((sum,p)=>sum+2*half(p),0);
    const gap=Math.max(12,free/(ports.length+1));
    let cursor=group[axis]+leading+Math.max(0,(free-gap*(ports.length-1))/2);
    for(const port of ports) {
      const previous={x:port.x,y:port.y},value=cursor+half(port),delta=value-port[axis];
      port[axis]=value;port.labelPosition[axis]+=delta;port.labelBounds[axis]+=delta;
      moved.set(group.id+'.'+port.id,{previous,port,axis,cross});cursor=value+half(port)+gap;
    }
  }
  const same=(a,b)=>Math.abs(a.x-b.x)<1e-6&&Math.abs(a.y-b.y)<1e-6;
  for(const edge of connections) for(const [endpoint,start] of [[edge.source,true],[edge.target,false]]) {
    const move=moved.get(endpoint.moduleId+'.'+endpoint.portId);if(!move) continue;
    for(const section of edge.sections) {
      const points=start?section.points:[...section.points].reverse();
      if(!same(points[0],move.previous)) continue;
      const next=points[1],{axis,cross}=move;
      if(Math.abs(next[axis]-move.previous[axis])>1e-6||Math.abs(next[cross]-move.previous[cross])<1e-6) throw new Error('Expected flow-aligned group port departure');
      const elbow=move.previous[cross]+Math.sign(next[cross]-move.previous[cross])*Math.min(6,Math.abs(next[cross]-move.previous[cross])/2);
      const joined=[{x:move.port.x,y:move.port.y},{[cross]:elbow,[axis]:move.port[axis]},{[cross]:elbow,[axis]:move.previous[axis]},...points.slice(1)];
      section.points=start?joined:joined.reverse();
    }
  }
}
