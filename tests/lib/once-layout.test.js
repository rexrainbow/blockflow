import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import Ajv from 'ajv/dist/2020.js';
import {createDiagramModel,layoutDiagram} from '../../src/lib/index.js';
import {fixture,checkLayout,freeze} from './helpers.js';
const schema=JSON.parse(await readFile(new URL('../../schema/blockflow.schema.json',import.meta.url),'utf8'));
const validate=new Ajv({strict:true}).compile(schema);
for(const [name,mutate,path] of [
  ['all mode',d=>d.layout={orderMode:'all'},'layout.orderMode'],
  ['auto mode',d=>d.layout={orderMode:'auto'},'layout.orderMode'],
  ['staged mode',d=>d.layout={orderMode:'staged'},'layout.orderMode'],
  ['edge priority order',d=>d.connections[0].order=0,'connections[0].order'],
  ['edge alignment',d=>d.connections[0].alignment=false,'connections[0].alignment'],
]) test('removed layout configuration is rejected: '+name,()=>{
  const d=fixture();mutate(d);assert.equal(validate(d),false);
  assert.throws(()=>createDiagramModel(d),error=>error.path===path);
});
for(const direction of ['right','left']) test('all connections participate together with fixed port order '+direction,async()=>{
  const raw=fixture();raw.layout={direction};raw.connections.push({from:'b.o',to:'a.i',feedback:true});
  const model=createDiagramModel(raw),before=structuredClone(model),layout=await layoutDiagram(freeze(model));
  checkLayout(model,layout);assert.deepEqual(model,before);assert.equal(layout.connections.length,2);
  assert.equal(Object.hasOwn(layout,'layoutInfo'),false);assert.equal(Object.hasOwn(model.layout,'orderMode'),false);
  for(const edge of layout.connections) {assert.equal(Object.hasOwn(edge,'order'),false);assert.equal(Object.hasOwn(edge,'alignment'),false);}
});
