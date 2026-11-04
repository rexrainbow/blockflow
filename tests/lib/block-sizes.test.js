import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import Ajv2020 from 'ajv/dist/2020.js';
import { createDiagramModel, layoutDiagram, renderSvg } from '../../src/lib/index.js';
import { moduleGeometry } from '../../src/lib/geometry.js';
import { fixture, freeze, checkLayout } from './helpers.js';

const sample=JSON.parse(await readFile(new URL('../../examples/block-sizes.json',import.meta.url),'utf8'));
const schema=JSON.parse(await readFile(new URL('../../schema/blockflow.schema.json',import.meta.url),'utf8'));
const validate=new Ajv2020({strict:true}).compile(schema);
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);

for(const axis of ['width','height']) test('relative minimum '+axis+' validates independently from port bit width',()=>{
  for(const value of [0.1,1,1.1,3.5]){
    const raw=fixture();raw.modules[0][axis]=value;
    assert.equal(validate(raw),true,JSON.stringify(validate.errors));
    assert.equal(createDiagramModel(raw).modules[0][axis],value);
  }
  for(const value of [0,-1,null,'3.5',Infinity,NaN,[],{}]){
    const raw=fixture();raw.modules[0][axis]=value;
    assert.equal(validate(raw),false);
    assert.throws(()=>createDiagramModel(raw),error=>error.path===`modules[0].${axis}`);
  }
  const raw=fixture();raw.modules[0].ports[0].width=1.1;
  assert.throws(()=>createDiagramModel(raw),error=>error.path==='modules[0].ports[0].width');
});

test('omission preserves auto geometry; size uses a fixed shared unit rather than scaling content',()=>{
  const raw=fixture();const automatic=createDiagramModel(raw);
  assert.equal(Object.hasOwn(automatic.modules[0],'width'),false);
  assert.deepEqual(moduleGeometry(automatic.modules[0]),{width:140,height:84,titleY:18,rowCenters:[60],portInset:10});
  raw.modules[0].width=1.1;raw.modules[0].height=3.5;
  const resized=createDiagramModel(raw), size=moduleGeometry(resized.modules[0]);
  near(size.width,154);near(size.height,294);near(size.titleY,18);near(size.rowCenters[0],165);
  assert.deepEqual(resized.modules[0].style,automatic.modules[0].style);
  assert.deepEqual(resized.modules[0].ports,automatic.modules[0].ports);
  raw.modules[0].label='Long title '.repeat(10);raw.modules[0].style={label:{fontSize:24}};
  const natural=structuredClone(raw);delete natural.modules[0].width;delete natural.modules[0].height;
  const required=moduleGeometry(createDiagramModel(natural).modules[0]);
  const final=moduleGeometry(createDiagramModel(raw).modules[0]);
  near(final.width,required.width);near(final.height,294);
});

test('height increases port gaps and preserves row pairing, title and minimum text clearance',()=>{
  const raw=structuredClone(sample), model=createDiagramModel(raw);
  const mux=model.modules.find(node=>node.id==='Mux');
  const original=moduleGeometry({...mux,height:undefined});
  const resized=moduleGeometry(mux);
  near(resized.height,294);near(resized.titleY,original.titleY);
  near(resized.rowCenters[0]-original.rowCenters[0],40.5);
  near(resized.rowCenters[1]-resized.rowCenters[0],64.5);
  near(resized.rowCenters[2]-resized.rowCenters[1],64.5);
  mux.height=0.1;
  assert.deepEqual(moduleGeometry(mux),original);
});

for(const direction of ['right','left']) test('ELK routes use resized borders/ports and SVG/PNG preserve dimensions '+direction,async()=>{
  const raw=structuredClone(sample);raw.layout.direction=direction;
  const model=createDiagramModel(raw),before=structuredClone(model);
  const layout=await layoutDiagram(freeze(model));checkLayout(model,layout);assert.deepEqual(model,before);
  const mux=layout.modules.find(node=>node.id==='Mux');near(mux.width,168);near(mux.height,294);
  near(mux.ports[0].y,mux.ports[3].y);
  const svg=renderSvg(layout);assert.ok(svg.includes('height="293"'));
  const png=await sharp(Buffer.from(svg)).png().toBuffer();
  assert.equal((await sharp(png).metadata()).format,'png');
});

test('group bounds grow around sized blocks; once and outer-feedback routes retain size',async()=>{
  const raw=fixture();raw.modules[0].width=2;raw.modules[0].height=3.5;
  raw.groups=[{id:'g',members:['a']}];
  let model=createDiagramModel(raw),layout=await layoutDiagram(model);checkLayout(model,layout);
  const a=layout.modules[0],group=layout.groups[0];
  assert.ok(a.x>group.x && a.y>group.y && a.x+a.width<group.x+group.width && a.y+a.height<group.y+group.height);
  delete raw.groups;raw.layout={direction:'right',feedbackRouting:'outer'};
  raw.connections.push({from:'b.o',to:'a.i',feedback:true});
  model=createDiagramModel(raw);layout=await layoutDiagram(model);checkLayout(model,layout);
  const node=layout.modules.find(node=>node.id==='a');near(node.width,280);near(node.height,294);
});
