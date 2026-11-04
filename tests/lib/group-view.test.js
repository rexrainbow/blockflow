import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import sharp from 'sharp';
import {createDiagramModel,layoutDiagram,renderSvg} from '../../src/lib/index.js';
import {copyLayout} from '../../src/lib/view/layout.js';
import {descendants} from '../../src/lib/hierarchy.js';
import {createConnectionContext} from '../../src/lib/connectivity.js';
import {freeze} from './helpers.js';
const boundary=JSON.parse(await readFile(new URL('../../examples/boundary-groups.json',import.meta.url),'utf8'));
const collection=JSON.parse(await readFile(new URL('../../examples/collection-instances.json',import.meta.url),'utf8'));

for(const rootGroupId of ['Inner','Outer']) for(const direction of ['left','right']) test('group view isolates the complete boundary interface and internal graph '+rootGroupId+' '+direction,async()=>{
  const raw=structuredClone(boundary);raw.layout.direction=direction;
  raw.groups.forEach(group=>group.collapsed=true);
  const model=createDiagramModel(freeze(raw)),snapshot=structuredClone(model);
  const layout=await layoutDiagram(freeze(model),{rootGroupId});copyLayout(layout);
  assert.deepEqual(model,snapshot);assert.equal(layout.rootGroupId,rootGroupId);
  const root=layout.groups.find(group=>group.id===rootGroupId);
  assert.equal(root.collapsed,false);assert.equal(root.depth,0);
  assert.deepEqual(root.ports.map(port=>port.id),model.groups.find(group=>group.id===rootGroupId).ports.map(port=>port.id));
  const included=descendants(model,rootGroupId);included.add(rootGroupId);
  assert.ok([...layout.modules,...layout.groups].every(item=>included.has(item.id)));
  assert.ok(layout.connections.every(edge=>included.has(edge.source.moduleId)&&included.has(edge.target.moduleId)));
  const context=createConnectionContext(model);
  const expected=model.connections.filter(edge=>included.has(context.resolve(edge.source.moduleId+'.'+edge.source.portId,edge.target.moduleId+'.'+edge.target.portId).scope));
  // The nested Inner group retains its own collapsed state inside Outer.
  const hidden=rootGroupId==='Outer'?descendants(model,'Inner'):new Set();
  assert.deepEqual(layout.connections.map(e=>e.id),expected.filter(e=>!hidden.has(e.source.moduleId)&&!hidden.has(e.target.moduleId)&&(rootGroupId!=='Outer'||e.scope!=='Inner')).map(e=>e.id));
  if(rootGroupId==='Inner') assert.ok(!layout.groups.some(group=>group.id==='Outer'));
  else assert.equal(layout.groups.find(group=>group.id==='Inner').collapsed,true);
  assert.ok(!layout.modules.some(node=>node.id==='Source'||node.id==='Sink'));
  const svg=renderSvg(layout);assert.ok(svg.includes('data-group="'+rootGroupId+'"'));
  const png=await sharp(Buffer.from(svg)).png().toBuffer();assert.ok((await sharp(png).metadata()).width>0);
  if(direction==='right') {await mkdir('output/group-view',{recursive:true});await writeFile('output/group-view/'+rootGroupId+'.svg',svg);await writeFile('output/group-view/'+rootGroupId+'.png',png);}
});

test('a group view includes inside pass-through but excludes same-owner external feedback',async()=>{
  const model=createDiagramModel({version:1,diagram:{name:'Faces'},modules:[],groups:[{id:'G',type:'boundary',collapsed:true,members:[],ports:[{id:'in',direction:'input'},{id:'out',direction:'output'}]}],connections:[{from:'G.in',to:'G.out',label:'Internal'},{from:'G.out',to:'G.in',label:'External',feedback:true}]});
  const layout=await layoutDiagram(model,{rootGroupId:'G'});copyLayout(layout);
  assert.deepEqual(layout.connections.map(e=>e.id),['connection_0']);
  assert.ok(renderSvg(layout).includes('Internal'));assert.ok(!renderSvg(layout).includes('External'));
});

test('Collection view expands only the root and restores real endpoints without synthetic ports',async()=>{
  const model=createDiagramModel(freeze(collection)),before=structuredClone(model);
  const layout=await layoutDiagram(model,{rootGroupId:'PEs'});copyLayout(layout);
  assert.deepEqual(model,before);assert.equal(layout.modules.length,16);assert.equal(layout.connections.length,15);
  assert.equal(layout.groups[0].ports.length,0);assert.equal(layout.groups[0].label,'Processing elements');
  assert.ok(layout.connections.every(edge=>!edge.routingSource));
  const top=await layoutDiagram(model);
  assert.equal(top.modules.length,2);assert.equal(top.groups[0].collapsed,true);
  assert.equal(top.connections.length,32);assert.equal(top.rootGroupId,undefined);
});

test('Container views do not fabricate ports for connections crossing the selected frame',async()=>{
  const raw=structuredClone(collection);raw.groups[0].type='container';raw.groups[0].collapsed=false;
  const layout=await layoutDiagram(createDiagramModel(raw),{rootGroupId:'PEs'});
  assert.equal(layout.modules.length,16);assert.equal(layout.connections.length,15);assert.deepEqual(layout.groups[0].ports,[]);
});

test('Top default is unchanged; unknown groups fail; full input validation still checks outside objects',async()=>{
  const model=createDiagramModel(boundary);
  assert.deepEqual(await layoutDiagram(model,{}),await layoutDiagram(model,{rootGroupId:null}));
  await assert.rejects(layoutDiagram(model,{rootGroupId:'missing'}),/Unknown view group/);
  await assert.rejects(layoutDiagram(model,{rootGroupId:false}),/Unknown view group/);
  const raw=structuredClone(boundary);raw.connections.push({from:'Source.missing',to:'Sink.in'});
  assert.throws(()=>createDiagramModel(raw),/Unknown port/);
});

test('group view keeps feedback inside the selected frame when outer routing is configured',async()=>{
  const raw={version:1,diagram:{name:'Loop'},modules:['A','B'].map(id=>({id,ports:[{id:'in',direction:'input'},{id:'out',direction:'output'}]})),groups:[{id:'G',members:['A','B']}],connections:[{from:'A.out',to:'B.in'},{from:'B.out',to:'A.in',feedback:true}],layout:{feedbackRouting:'outer'}};
  const layout=await layoutDiagram(createDiagramModel(raw),{rootGroupId:'G'}),root=layout.groups[0];
  for(const edge of layout.connections) {
    assert.equal(edge.routingInfo.reason,'group-view');
    for(const section of edge.sections) for(const point of section.points)
      assert.ok(point.x>=root.x-1e-6&&point.x<=root.x+root.width+1e-6&&point.y>=root.y-1e-6&&point.y<=root.y+root.height+1e-6);
  }
});
