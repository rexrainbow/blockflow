import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import sharp from 'sharp';
import { createDiagramModel, layoutDiagram, renderSvg } from '../../src/lib/index.js';
import { copyLayout } from '../../src/lib/view/layout.js';
import { freeze } from './helpers.js';
const fixture = JSON.parse(await readFile(new URL('../fixtures/boundary-minimal.json', import.meta.url), 'utf8'));
const example = JSON.parse(await readFile(new URL('../../examples/boundary-groups.json', import.meta.url), 'utf8'));
const near = (a,b) => Math.abs(a-b)<1e-6;
const pointEqual = (a,b) => near(a.x,b.x)&&near(a.y,b.y);

test('boundary ports validate nested faces and scopes without modifying input', () => {
  const raw=structuredClone(fixture), before=structuredClone(raw);
  const model=createDiagramModel(freeze(raw));
  assert.deepEqual(raw,before);
  assert.deepEqual(model.connections.map(edge=>edge.scope),['','Outer','Inner','Inner','Outer','']);
  assert.deepEqual(model.connections.map(edge=>edge.boundaryScoped),[false,true,true,true,true,false]);
  assert.equal(model.groups[0].ports[0].displayName,'Data\nin[7:0]');
  assert.equal(model.groups[1].ports[0].style.color,'#0f766e');
});

for (const [name,change,pattern] of [
  ['outer bypass',d=>{d.connections[0].to='Decode.in';},/boundary of group Outer/],
  ['inner bypass',d=>{d.connections[1].to='Decode.in';},/boundary of group Inner/],
  ['wrong internal source',d=>{d.connections[2].from='Inner.out';},/Expected input port/],
  ['wrong internal target',d=>{d.connections[3].to='Inner.in';},/Expected output port/],
  ['wrong external target',d=>{d.connections[0].to='Outer.out';},/Expected input port/],
  ['wrong external source',d=>{d.connections[5].from='Outer.in';},/Expected output port/],
  ['width mismatch',d=>{d.groups[0].ports[0].width=16;},/width mismatch/],
  ['multiple incoming drivers',d=>{d.connections.push({from:'Source.out',to:'Outer.in'});},/Duplicate connection/],
  ['invalid mode',d=>{d.groups[0].portMode=true;},/port mode/],
  ['duplicate port',d=>{d.groups[0].ports.push({...d.groups[0].ports[0]});},/Duplicate port/],
  ['invalid port label',d=>{d.groups[0].ports[0].label='\u0000';},/XML-compatible/],
  ['inactive endpoint',d=>{d.groups[0].portMode='direct';},/Unknown port/],
]) test('boundary validation rejects '+name,()=>{
  const d=structuredClone(fixture);change(d);assert.throws(()=>createDiagramModel(d),pattern);
});

test('direct groups retain inactive ports; boundary fanout and segment-only widths are allowed',()=>{
  const d=structuredClone(fixture);
  d.modules.push({id:'Tap',ports:[{id:'in',direction:'input',width:16}]});
  d.groups[1].members.push('Tap');
  delete d.groups[1].ports[0].width;
  d.connections.push({from:'Inner.in',to:'Tap.in'});
  assert.equal(createDiagramModel(d).connections.at(-1).width,16);
  d.connections=[];delete d.groups[0].portMode;
  assert.equal(createDiagramModel(d).groups[0].portMode,'direct');
  assert.equal(createDiagramModel(d).groups[0].ports.length,3);
  d.connections=[{from:'Source.out',to:'Decode.in'}];
  d.groups[1].portMode='direct';createDiagramModel(d);
});

test('group output endpoints still allow only one internal driver',()=>{
  const d=structuredClone(fixture);
  d.modules.push({id:'Other',ports:[{id:'out',direction:'output',width:8}]});
  d.groups[1].members.push('Other');d.connections.push({from:'Other.out',to:'Inner.out'});
  assert.throws(()=>createDiagramModel(d),/already has a driver/);
});

function verify(layout) {
  const owners=[...layout.modules,...layout.groups], anchors=new Map(owners.flatMap(node=>(node.ports??[]).map(port=>[node.id+'.'+port.id,port])));
  assert.ok(!JSON.stringify(layout).includes('@relay'));
  for(const group of layout.groups) {
    for(const port of group.ports) {
      assert.ok(near(port.x,group.x+(port.direction==='input'?0:group.width)));
      assert.ok(port.y>group.y&&port.y<group.y+group.height);
      assert.ok(port.labelBounds.x>=group.x-1e-6&&port.labelBounds.x+port.labelBounds.width<=group.x+group.width+1e-6,'group port label fits');
      assert.ok(port.labelBounds.y>=group.labelBounds.y+group.labelBounds.height,'port label clears group title');
    }
    for(const direction of ['input','output']) {
      const ports=group.ports.filter(port=>port.direction===direction);
      for(let i=1;i<ports.length;i++) assert.ok(ports[i].y>ports[i-1].y,'group port order');
    }
  }
  for(const edge of layout.connections) {
    const a=anchors.get(edge.source.moduleId+'.'+edge.source.portId),b=anchors.get(edge.target.moduleId+'.'+edge.target.portId);
    assert.ok(edge.sections.some(s=>pointEqual(s.points[0],a)),edge.id+' source');
    assert.ok(edge.sections.some(s=>pointEqual(s.points.at(-1),b)),edge.id+' target');
    for(const s of edge.sections) for(let i=1;i<s.points.length;i++) {
      const p=s.points[i-1],q=s.points[i];
      assert.ok(near(p.x,q.x)||near(p.y,q.y));
      for(const block of layout.modules) {
        const horizontal=near(p.y,q.y)&&p.y>block.y+1e-6&&p.y<block.y+block.height-1e-6&&Math.max(p.x,q.x)>block.x+1e-6&&Math.min(p.x,q.x)<block.x+block.width-1e-6;
        const vertical=near(p.x,q.x)&&p.x>block.x+1e-6&&p.x<block.x+block.width-1e-6&&Math.max(p.y,q.y)>block.y+1e-6&&Math.min(p.y,q.y)<block.y+block.height-1e-6;
        assert.ok(!horizontal&&!vertical,edge.id+' crosses '+block.id);
      }
      if(edge.scope) {
        const scope=layout.groups.find(g=>g.id===edge.scope);
        for(const point of [p,q]) assert.ok(point.x>=scope.x-1e-6&&point.x<=scope.x+scope.width+1e-6&&point.y>=scope.y-1e-6&&point.y<=scope.y+scope.height+1e-6,'internal edge stays inside');
      }
    }
  }
  copyLayout(layout);
}

for(const direction of ['right','left']) test('native nested boundary routes and unused ports '+direction,async()=>{
  const d=structuredClone(example);d.layout.direction=direction;
  const model=createDiagramModel(d),before=structuredClone(model);
  const layout=await layoutDiagram(freeze(model));assert.deepEqual(model,before);verify(layout);
  const svg=renderSvg(layout);assert.equal((svg.match(/data-role="group-port"/g)??[]).length,5);
  const png=await sharp(Buffer.from(svg)).png().toBuffer();assert.ok((await sharp(png).metadata()).width>0);
  if(direction==='right') {
    await mkdir('output/editor',{recursive:true});await writeFile('output/editor/boundary-groups.svg',svg);await writeFile('output/editor/boundary-groups.png',png);
  }
});

for(const direction of ['right','left']) test('empty boundary pass-through and external feedback preserve port order '+direction,async()=>{
  const ports=[['in','input'],['unused','input'],['out','output'],['spare','output']].map(([id,direction])=>({id,direction}));
  const d={version:1,diagram:{name:'Pass-through'},modules:[],groups:[{id:'G',members:[],portMode:'boundary',ports}],connections:[{from:'G.in',to:'G.out'},{from:'G.out',to:'G.in',feedback:true}],layout:{direction}};
  const model=createDiagramModel(d);assert.deepEqual(model.connections.map(e=>e.scope),['G','']);
  verify(await layoutDiagram(model));
});

test('outer feedback keeps internal boundary-scoped feedback inside its group',async()=>{
  const d=structuredClone(fixture);d.layout.feedbackRouting='outer';
  d.modules.find(m=>m.id==='Decode').ports.push({id:'loop',direction:'input',width:8});
  d.connections.push({from:'Decode.out',to:'Decode.loop',feedback:true});
  const layout=await layoutDiagram(createDiagramModel(d));verify(layout);
  assert.equal(layout.connections.at(-1).routingInfo.reason,'boundary-scope');
});

test('boundary ports work beneath a Direct ancestor with mixed port heights and multiple outputs',async()=>{
  const d=structuredClone(fixture);d.layout.direction='left';
  d.groups.push({id:'Container',members:['Outer']});
  d.groups[0].ports.push({id:'a',direction:'input',label:'Large\nmultiline\nlabel',style:{fontSize:26,padding:8}},{id:'b',direction:'output',label:'Second\noutput',style:{fontSize:20}},{id:'c',direction:'output'});
  const model=createDiagramModel(d),layout=await layoutDiagram(model);verify(layout);
  const direct=layout.groups.find(g=>g.id==='Container');assert.deepEqual(direct.ports,[]);
  const ports=layout.groups.find(g=>g.id==='Outer').ports.filter(p=>p.direction==='input');
  for(let i=1;i<ports.length;i++) assert.ok(ports[i].labelBounds.y>=ports[i-1].labelBounds.y+ports[i-1].labelBounds.height,'mixed label heights stay separate');
});

test('group-only pass-through supports global exterior feedback routing',async()=>{
  const d={version:1,diagram:{name:'Group-only'},modules:[],groups:[{id:'G',members:[],portMode:'boundary',ports:[{id:'in',direction:'input'},{id:'out',direction:'output'}]}],connections:[{from:'G.in',to:'G.out'},{from:'G.out',to:'G.in',feedback:true}],layout:{feedbackRouting:'outer'}};
  const layout=await layoutDiagram(createDiagramModel(d));verify(layout);
  assert.equal(layout.connections[0].routingInfo.reason,'boundary-scope');
});

test('pass-through beside real children merges relay routes and retains connection labels',async()=>{
  const d=structuredClone(fixture);d.layout.feedbackRouting='outer';
  d.groups[1].ports.push({id:'pass_in',direction:'input'},{id:'pass_out',direction:'output'});
  d.connections.push({from:'Inner.pass_in',to:'Inner.pass_out',label:'Internal\npass-through'},{from:'Inner.pass_out',to:'Inner.pass_in',feedback:true});
  const layout=await layoutDiagram(createDiagramModel(d));verify(layout);
  assert.equal(layout.connections.at(-2).label,'Internal\npass-through');
  assert.equal(layout.connections.at(-1).scope,'Outer');
  assert.equal(layout.connections.at(-1).routingInfo.reason,'boundary-scope');
});
