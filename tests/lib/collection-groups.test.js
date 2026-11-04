import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import Ajv from 'ajv/dist/2020.js';
import sharp from 'sharp';
import {createDiagramModel,layoutDiagram,renderSvg} from '../../src/lib/index.js';
import {copyLayout,connectionKey} from '../../src/lib/view/layout.js';
import {freeze} from './helpers.js';
const fixture=JSON.parse(await readFile(new URL('../../examples/collection-instances.json',import.meta.url),'utf8'));
const schema=JSON.parse(await readFile(new URL('../../schema/blockflow.schema.json',import.meta.url),'utf8'));
const validate=new Ajv({strict:true,allErrors:true}).compile(schema);
const endpoint=p=>p.moduleId+'.'+p.portId;

test('canonical group types agree with the schema and preserve the legacy alias',()=>{
  for(const type of ['container','boundary','collection',null,false,'stack']) {
    const raw=structuredClone(fixture);raw.connections=[];raw.groups[0].collapsed=false;raw.groups[0].type=type;
    const valid=['container','boundary','collection'].includes(type);
    assert.equal(validate(raw),valid,JSON.stringify(type));
    if(valid) assert.equal(createDiagramModel(raw).groups[0].type,type);
    else assert.throws(()=>createDiagramModel(raw),/group type/);
  }
  const raw=structuredClone(fixture);raw.connections=[];raw.groups[0].portMode='boundary';
  assert.equal(validate(raw),false);assert.throws(()=>createDiagramModel(raw),/Conflicting/);
  delete raw.groups[0].type;
  assert.equal(validate(raw),true);assert.equal(createDiagramModel(raw).groups[0].type,'boundary');
  raw.groups[0].portMode='direct';raw.groups[0].collapsed=false;
  assert.equal(createDiagramModel(raw).groups[0].type,'container');
  raw.groups[0].collapsed=true;
  assert.equal(validate(raw),false);assert.throws(()=>createDiagramModel(raw),/Only boundary or collection/);
});

for(const direction of ['right','left']) test('16 instances project onto two virtual anchors without changing source identities '+direction,async()=>{
  const raw=structuredClone(fixture);raw.layout.direction=direction;
  raw.connections[0].label='Input\ndata';
  const before=structuredClone(raw),model=createDiagramModel(freeze(raw)),snapshot=structuredClone(model);
  const layout=await layoutDiagram(freeze(model));copyLayout(layout);
  assert.deepEqual(raw,before);assert.deepEqual(model,snapshot);
  assert.equal(layout.modules.length,2);assert.equal(layout.connections.length,32);
  const group=layout.groups[0];
  assert.equal(group.memberCount,16);assert.equal(group.stackLayers,2);
  assert.equal(group.label,'Processing elements ×16');assert.deepEqual(group.members,[]);
  assert.deepEqual(group.ports.map(p=>[p.direction,p.width,p.virtual]),[['input',null,true],['output',null,true]]);
  assert.equal(group.height,group.faceHeight+12);
  const nodes=[...layout.modules,group];
  const ports=new Map(nodes.flatMap(n=>n.ports.map(p=>[n.id+'.'+p.id,p])));
  for(const edge of layout.connections) {
    const original=raw.connections[Number(edge.id.split('_')[1])];
    assert.equal(endpoint(edge.source),original.from);assert.equal(endpoint(edge.target),original.to);
    const start=ports.get(endpoint(edge.routingSource)),end=ports.get(endpoint(edge.routingTarget));
    assert.ok(edge.sections.some(s=>Math.abs(s.points[0].x-start.x)<1e-6&&Math.abs(s.points[0].y-start.y)<1e-6));
    assert.ok(edge.sections.some(s=>Math.abs(s.points.at(-1).x-end.x)<1e-6&&Math.abs(s.points.at(-1).y-end.y)<1e-6));
    for(const section of edge.sections) for(let i=1;i<section.points.length;i++) {
      const p=section.points[i-1],q=section.points[i];
      assert.ok(Math.abs(p.x-q.x)<1e-6||Math.abs(p.y-q.y)<1e-6);
      for(const n of nodes) {
        const h=Math.abs(p.y-q.y)<1e-6&&p.y>n.y+1e-6&&p.y<n.y+n.height-1e-6&&Math.max(p.x,q.x)>n.x+1e-6&&Math.min(p.x,q.x)<n.x+n.width-1e-6;
        const v=Math.abs(p.x-q.x)<1e-6&&p.x>n.x+1e-6&&p.x<n.x+n.width-1e-6&&Math.max(p.y,q.y)>n.y+1e-6&&Math.min(p.y,q.y)<n.y+n.height-1e-6;
        assert.ok(!h&&!v,edge.id+' crosses '+n.id);
      }
    }
  }
  assert.equal(new Set(layout.connections.map(connectionKey)).size,32);
  assert.equal(model.groups[0].ports.length,0);
  const svg=renderSvg(layout);assert.equal((svg.match(/data-role="collection-layer"/g)??[]).length,2);
  assert.ok(!svg.includes('PE 15'));assert.ok(svg.includes('Processing elements ×16'));
  assert.ok((await sharp(await sharp(Buffer.from(svg)).png().toBuffer()).metadata()).width>0);
});

test('expanded collections restore every child and internal edge',async()=>{
  const raw=structuredClone(fixture);raw.groups[0].collapsed=false;
  const expanded=await layoutDiagram(createDiagramModel(raw));copyLayout(expanded);
  assert.equal(expanded.modules.length,18);assert.equal(expanded.connections.length,47);
  assert.equal(expanded.groups[0].ports.length,0);assert.equal(expanded.groups[0].stackLayers,undefined);
  assert.ok(expanded.connections.every(e=>!e.routingSource));
});

test('real widths, drivers and hidden endpoints remain validated before projection',()=>{
  const raw=structuredClone(fixture);raw.modules[1].ports[0].width=9;
  assert.throws(()=>createDiagramModel(raw),/width mismatch/);
  raw.modules[1].ports[0].width=8;
  raw.connections.push({from:'PE_1.out',to:'PE_0.in'});
  assert.throws(()=>createDiagramModel(raw),/already has a driver/);
  raw.connections.pop();raw.connections[0].to='PE_0.missing';
  assert.throws(()=>createDiagramModel(raw),/Unknown port/);
});

test('nested collection projection uses the outermost collapse and counts direct children',async()=>{
  const raw=structuredClone(fixture);
  raw.groups.push({id:'Inner',type:'collection',collapsed:true,members:raw.groups[0].members.splice(0,8)});
  raw.groups[0].members.push('Inner');
  let layout=await layoutDiagram(createDiagramModel(raw));
  assert.equal(layout.groups.length,1);assert.equal(layout.groups[0].memberCount,9);
  raw.groups[0].collapsed=false;
  layout=await layoutDiagram(createDiagramModel(raw));copyLayout(layout);
  assert.equal(layout.groups.length,2);assert.equal(layout.modules.length,10);
  assert.equal(layout.groups.find(g=>g.id==='Inner').memberCount,8);
  assert.equal(layout.connections.find(e=>e.id==='connection_0').routingTarget.moduleId,'Inner');
});

test('empty and single-member collections have a count without decorative copies',async()=>{
  for(const count of [0,1]) {
    const raw=structuredClone(fixture);raw.connections=[];raw.groups[0].members=raw.groups[0].members.slice(0,count);
    const group=(await layoutDiagram(createDiagramModel(raw))).groups[0];
    assert.equal(group.memberCount,count);assert.equal(group.stackLayers,0);
    assert.equal(group.label,'Processing elements ×'+count);
  }
});

test('collection projection respects boundary faces and hidden boundary ancestors',async()=>{
  const raw={version:1,diagram:{name:'Nested'},modules:[{id:'A',ports:[{id:'in',direction:'input'},{id:'out',direction:'output'}]}],groups:[
    {id:'Outer',type:'boundary',members:['G'],ports:[{id:'in',direction:'input'},{id:'out',direction:'output'}]},
    {id:'G',type:'collection',members:['A'],collapsed:true},
  ],connections:[{from:'Outer.in',to:'A.in'},{from:'A.out',to:'Outer.out'}]};
  let layout=await layoutDiagram(createDiagramModel(raw));copyLayout(layout);
  assert.equal(layout.connections.length,2);assert.equal(layout.connections[0].routingTarget.moduleId,'G');
  raw.groups[0].collapsed=true;
  layout=await layoutDiagram(createDiagramModel(raw));
  assert.equal(layout.connections.length,0);assert.equal(layout.groups.length,1);
});

test('outer feedback routing uses visible collection anchors',async()=>{
  const raw=structuredClone(fixture);raw.modules[0].ports.push({id:'in',direction:'input',width:8});
  raw.connections.push({from:'PE_15.out',to:'Source.in',feedback:true});raw.layout.feedbackRouting='outer';
  const layout=await layoutDiagram(createDiagramModel(raw));copyLayout(layout);
  assert.equal(layout.connections.at(-1).routingSource.moduleId,'PEs');
  assert.ok(layout.connections.at(-1).routingInfo);
});

test('crossings between sibling collections retain both original endpoints and group style inheritance',async()=>{
  const raw=structuredClone(fixture);
  const members=raw.groups[0].members.splice(8);
  raw.groups.push({id:'Other',type:'collection',collapsed:true,members,style:{portLabel:{color:'#123456',fontSize:16}}});
  const layout=await layoutDiagram(createDiagramModel(raw));copyLayout(layout);
  const crossing=layout.connections.find(e=>endpoint(e.source)==='PE_7.out'&&endpoint(e.target)==='PE_8.next');
  assert.ok(crossing);assert.equal(crossing.routingSource.moduleId,'PEs');assert.equal(crossing.routingTarget.moduleId,'Other');
  const group=layout.groups.find(g=>g.id==='Other');
  assert.equal(group.memberCount,8);assert.ok(group.ports.every(p=>p.style.color==='#123456'&&p.style.fontSize===16));
  const malformed=structuredClone(layout);malformed.connections[0].routingTarget.portId='missing';
  assert.throws(()=>copyLayout(malformed),/edge endpoint/);
});
