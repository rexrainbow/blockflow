import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import sharp from 'sharp';
import { createDiagramModel, layoutDiagram, renderSvg } from '../../src/lib/index.js';
import { copyLayout } from '../../src/lib/view/layout.js';
import { emptyDocument,addModule,addPort,removePort,movePort,convertToBoundaryGroup } from '../../src/editor/state/commands.js';
import { checkLayout } from './helpers.js';
const example=JSON.parse(await readFile(new URL('../../examples/concat.json',import.meta.url),'utf8'));
const schema=JSON.parse(await readFile(new URL('../../schema/blockflow.schema.json',import.meta.url),'utf8'));
const validate=new Ajv2020({strict:true}).compile(schema);
const single=()=>({version:1,diagram:{name:'Concat'},modules:[{id:'C',type:'concat',ports:[{id:'a',direction:'input'},{id:'b',direction:'input'},{id:'out',direction:'output'}]}]});

test('abstract, partial and explicit widths preserve input JSON and never infer widths',()=>{
  for(const widths of [[undefined,undefined,undefined],[16,16,undefined],[16,undefined,32],[undefined,undefined,32],[16,16,32],[16,16,1]]) {
    const raw=single();widths.forEach((w,i)=>{if(w!==undefined)raw.modules[0].ports[i].width=w;});
    if(widths[2]===1){assert.throws(()=>createDiagramModel(raw),/sum/);continue;}
    const snapshot=structuredClone(raw),model=createDiagramModel(raw);
    assert.deepEqual(raw,snapshot);
    assert.deepEqual(model.modules[0].ports.map(p=>p.width),widths.map(w=>w??null));
    assert.equal(validate(raw),true,JSON.stringify(validate.errors));
  }
});

test('concat shape rules and type validation match schema; exact sums include safe-integer extremes',()=>{
  const mutations=[d=>d.modules[0].type=null,d=>d.modules[0].type='merge',d=>d.modules[0].ports.splice(0,2),d=>d.modules[0].ports.pop(),d=>d.modules[0].ports.push({id:'other',direction:'output'})];
  for(const change of mutations){const d=single();change(d);assert.equal(validate(d),false);assert.throws(()=>createDiagramModel(d));}
  const d=single();for(const p of d.modules[0].ports)p.width=Number.MAX_SAFE_INTEGER;
  assert.throws(()=>createDiagramModel(d),/sum/);
  d.modules[0].ports.splice(1,1);assert.doesNotThrow(()=>createDiagramModel(d));
});

for(const direction of ['right','left']) test(`abstract and sized concatenation routes, renders and mounts (${direction})`,async()=>{
  const raw=structuredClone(example);raw.layout={direction};assert.equal(validate(raw),true,JSON.stringify(validate.errors));
  const model=createDiagramModel(raw),layout=await layoutDiagram(model);checkLayout(model,layout);
  for(const block of layout.modules.filter(m=>m.type==='concat')){
    assert.equal(block.width,12);assert.equal(block.body.type,'bar');
    const inputs=block.ports.filter(p=>p.direction==='input'),out=block.ports.find(p=>p.direction==='output');
    assert.equal(out.y,(inputs[0].y+inputs.at(-1).y)/2);
  }
  assert.deepEqual(copyLayout(layout),layout);
  const svg=renderSvg(layout);assert.equal((svg.match(/data-appearance="bar"/g)??[]).length,2);
  assert.ok((await sharp(Buffer.from(svg)).png().toBuffer()).length>1000);
});

test('editor creation, input ordering and minimum port guards preserve concat semantics',()=>{
  const d=emptyDocument(),id=addModule(d,'concat'),block=d.modules[0];
  assert.equal(block.id,id);assert.equal(block.type,'concat');assert.equal(block.ports.length,3);
  const first=block.ports[0].id;movePort(block,'input',0,1);assert.equal(block.ports[1].id,first);
  addPort(block,'input');removePort(d,id,first);
  const snapshot=structuredClone(d);assert.throws(()=>addPort(block,'output'),/exactly one output/);assert.throws(()=>removePort(d,id,'out'),/exactly one output/);assert.throws(()=>convertToBoundaryGroup(d,id),/Concat/);assert.deepEqual(d,snapshot);
  for(const p of [...block.ports.filter(p=>p.direction==='input')].slice(1))removePort(d,id,p.id);
  assert.throws(()=>removePort(d,id,block.ports.find(p=>p.direction==='input').id),/at least one input/);
  assert.doesNotThrow(()=>createDiagramModel(d));
});

test('Concat identity survives container scope and generic Bar keeps multiple outputs distinct',async()=>{
  const raw=structuredClone(example);raw.groups=[{id:'Frame',members:raw.modules.map(m=>m.id)}];
  const scoped=await layoutDiagram(createDiagramModel(raw),{rootGroupId:'Frame'});
  assert.equal(scoped.modules.filter(m=>m.type==='concat').length,2);
  assert.deepEqual(copyLayout(scoped),scoped);
  const generic=single();delete generic.modules[0].type;
  generic.modules[0].appearance={type:'bar'};
  generic.modules[0].ports.push({id:'out2',direction:'output'});
  const layout=await layoutDiagram(createDiagramModel(generic));
  const outputs=layout.modules[0].ports.filter(p=>p.direction==='output');
  assert.notEqual(outputs[0].y,outputs[1].y);
});
