import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import sharp from 'sharp';
import Ajv from 'ajv/dist/2020.js';
import {createDiagramModel,layoutDiagram,renderSvg} from '../../src/lib/index.js';
import {moduleGeometry} from '../../src/lib/geometry.js';
import {copyLayout} from '../../src/lib/view/layout.js';
import {freeze} from './helpers.js';
const fixture=JSON.parse(await readFile(new URL('../../examples/boundary-groups.json',import.meta.url),'utf8'));
const schema=JSON.parse(await readFile(new URL('../../schema/blockflow.schema.json',import.meta.url),'utf8'));
const validate=new Ajv({strict:true,allErrors:true}).compile(schema);
const near=(a,b)=>Math.abs(a-b)<1e-6;
const point=(a,b)=>near(a.x,b.x)&&near(a.y,b.y);
const collapse=(raw,id)=>{raw.groups.find(g=>g.id===id).collapsed=true;return raw;};

for(const value of [true,false,0,1,'true',null,{},[]]) test('collapsed schema and model boolean '+JSON.stringify(value),()=>{
  const raw=structuredClone(fixture);raw.groups[1].collapsed=value;
  const valid=typeof value==='boolean';assert.equal(validate(raw),valid);
  if(valid) assert.equal(createDiagramModel(raw).groups[1].collapsed,value);
  else assert.throws(()=>createDiagramModel(raw),/boolean/);
});

test('Direct groups reject hiding, including beneath a hidden ancestor; defaults remain expanded',()=>{
  const raw=structuredClone(fixture);raw.connections=[];raw.groups[1].portMode='direct';raw.groups[1].collapsed=true;
  assert.equal(validate(raw),false);assert.throws(()=>createDiagramModel(raw),/Only boundary or collection groups/);
  collapse(raw,'Outer');assert.throws(()=>createDiagramModel(raw),/Only boundary or collection groups/);
  delete raw.groups[1].collapsed;assert.equal(createDiagramModel(raw).groups[1].collapsed,false);
});

function verify(layout) {
  copyLayout(layout);
  const owners=[...layout.modules,...layout.groups],leaves=owners.filter(n=>!n.members||n.collapsed);
  const ports=new Map(owners.flatMap(n=>n.ports.map(p=>[n.id+'.'+p.id,p])));
  for(const edge of layout.connections) {
    const a=ports.get(edge.source.moduleId+'.'+edge.source.portId),b=ports.get(edge.target.moduleId+'.'+edge.target.portId);
    assert.ok(edge.sections.some(s=>point(s.points[0],a)));assert.ok(edge.sections.some(s=>point(s.points.at(-1),b)));
    for(const section of edge.sections) for(let i=1;i<section.points.length;i++) {
      const p=section.points[i-1],q=section.points[i];assert.ok(near(p.x,q.x)||near(p.y,q.y));
      for(const node of leaves) {
        const h=near(p.y,q.y)&&p.y>node.y+1e-6&&p.y<node.y+node.height-1e-6&&Math.max(p.x,q.x)>node.x+1e-6&&Math.min(p.x,q.x)<node.x+node.width-1e-6;
        const v=near(p.x,q.x)&&p.x>node.x+1e-6&&p.x<node.x+node.width-1e-6&&Math.max(p.y,q.y)>node.y+1e-6&&Math.min(p.y,q.y)<node.y+node.height-1e-6;
        assert.ok(!h&&!v,`${edge.id} crosses leaf ${node.id}`);
      }
    }
  }
}

for(const direction of ['right','left']) for(const id of ['Inner','Outer']) test('collapse '+id+' uses leaf geometry and excludes descendants '+direction,async()=>{
  const raw=collapse(structuredClone(fixture),id);raw.layout.direction=direction;
  const before=structuredClone(raw),model=createDiagramModel(freeze(raw)),modelBefore=structuredClone(model);
  const layout=await layoutDiagram(freeze(model));verify(layout);
  assert.deepEqual(raw,before);assert.deepEqual(model,modelBefore);
  assert.equal(layout.modules.length,id==='Inner'?7:2);
  assert.equal(layout.groups.length,id==='Inner'?2:1);
  const group=layout.groups.find(g=>g.id===id),source=model.groups.find(g=>g.id===id),geometry=moduleGeometry(source);
  assert.equal(group.collapsed,true);assert.equal(group.width,geometry.width);assert.equal(group.height,geometry.height);
  assert.deepEqual(group.members,[]);assert.equal(group.labelPosition.anchor,'middle');
  for(const port of group.ports) {
    assert.ok(near(port.x,group.x+(port.direction==='input'?0:group.width)));
    assert.ok(near(port.y,port.labelPosition.y));
  }
  if(id==='Outer') assert.deepEqual(layout.connections.map(e=>e.id),['connection_0','connection_14']);
  const svg=renderSvg(layout);assert.ok(svg.includes('data-collapsed="true"'));assert.ok(!svg.includes('Dispatch'));
  const png=await sharp(Buffer.from(svg)).png().toBuffer();assert.ok((await sharp(png).metadata()).width>0);
  if(direction==='right') {await mkdir('output/editor',{recursive:true});await writeFile('output/editor/collapsed-'+id+'.svg',svg);await writeFile('output/editor/collapsed-'+id+'.png',png);}
});

test('hidden styles, text, dimensions and strokes never influence layout; invalid hidden data still fails',async()=>{
  const raw=collapse(structuredClone(fixture),'Inner'),first=await layoutDiagram(createDiagramModel(raw));
  raw.modules.find(n=>n.id==='Execute').width=100000;
  raw.modules.find(n=>n.id==='Decode').label='Hidden text '.repeat(500);
  raw.connections[4].style={strokeWidth:10000,label:{fontSize:1000}};raw.connections[4].label='Invisible';
  assert.deepEqual(await layoutDiagram(createDiagramModel(raw)),first);
  raw.connections[4].to='Unknown.in';assert.throws(()=>createDiagramModel(raw),/Unknown port/);
});

test('outer collapse overrides inner visibility without rewriting its stored setting',async()=>{
  const raw=collapse(collapse(structuredClone(fixture),'Inner'),'Outer');
  assert.equal((await layoutDiagram(createDiagramModel(raw))).groups.length,1);
  raw.groups[0].collapsed=false;
  assert.equal((await layoutDiagram(createDiagramModel(raw))).groups.find(g=>g.id==='Inner').collapsed,true);
  raw.groups[1].collapsed=false;
  const restored=await layoutDiagram(createDiagramModel(raw)),original=await layoutDiagram(createDiagramModel(fixture));
  assert.deepEqual(restored,original);
});

for(const feedbackRouting of ['elk','outer']) test('internal same-group pass-through disappears; external feedback stays '+feedbackRouting,async()=>{
  const raw={version:1,diagram:{name:'Loop'},modules:[],groups:[{id:'G',members:[],portMode:'boundary',collapsed:true,ports:[{id:'in',direction:'input'},{id:'out',direction:'output'}]}],connections:[{from:'G.in',to:'G.out',label:'Hidden pass'},{from:'G.out',to:'G.in',feedback:true,label:'External feedback'}],layout:{feedbackRouting}};
  const layout=await layoutDiagram(createDiagramModel(raw));verify(layout);
  assert.deepEqual(layout.connections.map(e=>e.id),['connection_1']);assert.ok(!renderSvg(layout).includes('Hidden pass'));
});

test('an empty collapsed boundary works without ports or connections in once layout',async()=>{
  const raw={version:1,diagram:{name:'Empty'},modules:[],groups:[{id:'G',members:[],portMode:'boundary',collapsed:true}]};
  const layout=await layoutDiagram(createDiagramModel(raw));verify(layout);assert.deepEqual(layout.groups[0].ports,[]);
});

test('collapsed boundary inside an expanded Direct group keeps cross-container routes',async()=>{
  const raw=collapse(structuredClone(fixture),'Inner');raw.groups[0].portMode='direct';
  raw.connections=raw.connections.filter(e=>e.to!=='Outer.in'&&e.to!=='Outer.out').map(e=>({
    ...e,from:e.from==='Outer.in'?'Source.out':e.from==='Outer.out'?'OutputQueue.out':e.from,
  }));
  const layout=await layoutDiagram(createDiagramModel(raw));verify(layout);
  assert.equal(layout.groups.find(g=>g.id==='Outer').collapsed,false);
  assert.equal(layout.groups.find(g=>g.id==='Inner').collapsed,true);
});
