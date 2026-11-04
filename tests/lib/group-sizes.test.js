import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import Ajv from 'ajv/dist/2020.js';
import {createDiagramModel,layoutDiagram} from '../../src/lib/index.js';
const schema=JSON.parse(await readFile(new URL('../../schema/blockflow.schema.json',import.meta.url),'utf8'));
const validate=new Ajv({strict:true}).compile(schema);
const fixture=()=>({version:1,diagram:{name:'Sized groups'},modules:[],groups:[{id:'G',members:[],portMode:'boundary',ports:[{id:'in',direction:'input'},{id:'out',direction:'output'}]}]});
for(const axis of ['width','height']) test('group '+axis+' accepts relative positive minima and rejects invalid values',()=>{
  for(const value of [0.1,1,3.5]) {const d=fixture();d.groups[0][axis]=value;assert.equal(validate(d),true);assert.equal(createDiagramModel(d).groups[0][axis],value);}
  for(const value of [0,-1,null,'3.5',Infinity,NaN,{},[]]) {const d=fixture();d.groups[0][axis]=value;assert.equal(validate(d),false);assert.throws(()=>createDiagramModel(d),error=>error.path===`groups[0].${axis}`);}
});
for(const collapsed of [false,true]) test('group size minima use 140 x 84 units, expanded='+!collapsed,async()=>{
  const d=fixture();Object.assign(d.groups[0],{collapsed,width:3.1,height:3.5});
  const l=await layoutDiagram(createDiagramModel(d)),g=l.groups[0];assert.ok(g.width>=434-1e-6);assert.ok(g.height>=294-1e-6);
  assert.equal(g.style.label.fontSize,12);assert.equal(g.ports[0].style.fontSize,12);
});
test('expanded group grows beyond minimum to contain a large child; omission retains Auto',async()=>{
  const d=fixture();d.modules=[{id:'Child',width:8,height:7,ports:[{id:'in',direction:'input'}]}];
  Object.assign(d.groups[0],{members:['Child'],width:1,height:1});
  const l=await layoutDiagram(createDiagramModel(d));assert.ok(l.groups[0].width>l.modules[0].width);assert.ok(l.groups[0].height>l.modules[0].height);
  delete d.groups[0].width;delete d.groups[0].height;const model=createDiagramModel(d);assert.equal(Object.hasOwn(model.groups[0],'width'),false);
});
