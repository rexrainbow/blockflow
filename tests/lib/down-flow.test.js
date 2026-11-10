import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import sharp from 'sharp';
import {createDiagramModel,layoutDiagram,renderSvg} from '../../src/lib/index.js';
import {copyLayout} from '../../src/lib/blockchart/view/layout.js';
import {setDirection} from '../../src/lib/blockchart/direction.js';
const load=async name=>JSON.parse(await readFile(new URL(`../../examples/${name}.json`,import.meta.url),'utf8'));
const schema=JSON.parse(await readFile(new URL('../../schema/blockchart.schema.json',import.meta.url),'utf8'));
const validate=new Ajv2020({strict:true}).compile(schema);
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-5,`${a} != ${b}`);
const down=raw=>{setDirection(raw,'down');return raw;};

test('direction and feedback-side changes map reversibly without touching endpoints or order',async()=>{
  const raw=await load('signal-schematic'),before=structuredClone(raw);
  setDirection(raw,'down');assert.equal(raw.layout.feedbackSide,'left');assert.equal(validate(raw),true,JSON.stringify(validate.errors));
  assert.deepEqual(raw.modules,before.modules);assert.deepEqual(raw.connections,before.connections);
  setDirection(raw,'right');assert.deepEqual(raw,before);
  for(const [direction,side] of [['down','top'],['right','left'],['down','bottom']]){
    raw.layout.direction=direction;raw.layout.feedbackSide=side;
    assert.equal(validate(raw),false);assert.throws(()=>createDiagramModel(raw));
  }
});

for(const name of ['concat','terminals','block-appearances','boundary-groups','collection-instances','vertical-flow']) test(`Down flow preserves endpoints, horizontal text and complete bounds: ${name}`,async()=>{
  const raw=down(await load(name)),before=structuredClone(raw),model=createDiagramModel(raw),layout=await layoutDiagram(model);
  assert.deepEqual(raw,before);assert.deepEqual(copyLayout(layout),layout);
  for(const block of layout.modules){
    const original=model.modules.find(m=>m.id===block.id);
    for(const dir of ['input','output']){
      const ports=block.ports.filter(p=>p.direction===dir);
      assert.deepEqual(ports.map(p=>p.id),original.ports.filter(p=>p.direction===dir).map(p=>p.id));
      for(const [i,p] of ports.entries()) {near(p.y,block.y+(dir==='input'?0:block.height));if(i)assert.ok(p.x>ports[i-1].x);}
    }
    for(const p of block.ports.filter(p=>!p.style.hidden)){
      assert.ok(p.labelBounds.x>=block.x-1e-5);assert.ok(p.labelBounds.x+p.labelBounds.width<=block.x+block.width+1e-5);
      assert.ok(p.labelBounds.y>=block.y-1e-5);assert.ok(p.labelBounds.y+p.labelBounds.height<=block.y+block.height+1e-5);
    }
    if(block.type==='concat')assert.ok(block.width>block.height);
  }
  for(const terminal of layout.terminals??[]) {near(terminal.anchor.x,terminal.x+terminal.width/2);near(terminal.anchor.y,terminal.y+(terminal.direction==='input'?terminal.height:0));}
  for(const group of layout.groups??[])for(const dir of ['input','output']){
    const ports=group.ports.filter(p=>p.direction===dir);
    for(const [i,p] of ports.entries()){near(p.y,group.y+(dir==='input'?0:group.height));if(i)assert.ok(p.x>ports[i-1].x);}
  }
  for(const group of layout.groups??[])if(!group.style.label.hidden&&!group.collapsed){
    const b=group.labelBounds;
    for(const edge of layout.connections)for(const section of edge.sections)for(let i=1;i<section.points.length;i++){
      const a=section.points[i-1],c=section.points[i];
      const horizontal=Math.abs(a.y-c.y)<1e-6 && a.y>b.y && a.y<b.y+b.height && Math.max(a.x,c.x)>b.x && Math.min(a.x,c.x)<b.x+b.width;
      const vertical=Math.abs(a.x-c.x)<1e-6 && a.x>b.x && a.x<b.x+b.width && Math.max(a.y,c.y)>b.y && Math.min(a.y,c.y)<b.y+b.height;
      assert.ok(!horizontal&&!vertical,edge.id+' crosses group title '+group.id);
    }
  }
  const anchors=new Map([...layout.modules,...layout.groups??[]].flatMap(n=>(n.ports??[]).map(p=>[`${n.id}.${p.id}`,p])));
  for(const t of layout.terminals??[])anchors.set('@terminal:'+t.id,t.anchor);
  const key=e=>e.terminal!==undefined?'@terminal:'+e.terminal:e.moduleId+'.'+e.portId;
  for(const e of layout.connections){
    const from=anchors.get(key(e.routingSource??e.source)),to=anchors.get(key(e.routingTarget??e.target));
    near(e.sections[0].points[0].x,from.x);near(e.sections[0].points[0].y,from.y);
    near(e.sections.at(-1).points.at(-1).x,to.x);near(e.sections.at(-1).points.at(-1).y,to.y);
    if(e.arrow)assert.deepEqual(e.arrow.points[0],e.sections.at(-1).points.at(-1));
  }
  const svg=renderSvg(layout);assert.ok(!svg.includes('rotate('));assert.ok((await sharp(Buffer.from(svg)).png().toBuffer()).length>1000);
});

for(const side of ['auto','left','right'])test(`Down exterior feedback follows ${side}`,async()=>{
  const raw=down(await load('signal-schematic'));raw.layout.feedbackSide=side;
  const layout=await layoutDiagram(createDiagramModel(raw)),edge=layout.connections.at(-1);
  assert.equal(edge.routingInfo.method,'outer-aabb');if(side!=='auto')assert.equal(edge.routingInfo.side,side);
  const x=edge.routingInfo.waypoints[0].x;
  assert.ok(layout.modules.every(m=>edge.routingInfo.side==='left'?x<m.x:x>m.x+m.width));
});

test('Down scoped boundary and collapsed boundary keep real port identities',async()=>{
  const raw=down(await load('boundary-groups')),model=createDiagramModel(raw);
  const scoped=await layoutDiagram(model,{rootGroupId:'Inner'});assert.equal(scoped.rootGroupId,'Inner');assert.deepEqual(copyLayout(scoped),scoped);
  raw.groups.find(g=>g.id==='Inner').collapsed=true;
  const collapsed=await layoutDiagram(createDiagramModel(raw)),group=collapsed.groups.find(g=>g.id==='Inner');
  for(const p of group.ports)near(p.y,group.y+(p.direction==='input'?0:group.height));
});
