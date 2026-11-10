import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import Ajv2020 from 'ajv/dist/2020.js';
import sharp from 'sharp';
import { createDiagramModel, layoutDiagram, renderSvg } from '../../src/lib/index.js';
import { copyLayout } from '../../src/lib/blockchart/view/layout.js';
import { fixture } from './helpers.js';

const raw = JSON.parse(await readFile(new URL('../../examples/hidden-labels.json', import.meta.url), 'utf8'));
const schema = JSON.parse(await readFile(new URL('../../schema/blockchart.schema.json', import.meta.url), 'utf8'));
const validate = new Ajv2020({strict:true}).compile(schema);

test('hidden is strictly boolean and belongs only to text styles; removed field is rejected', () => {
  assert.equal(validate(raw),true,JSON.stringify(validate.errors));
  for (const style of [{hidden:'true'},{hidden:null},{hidden:1}]) {
    const d=structuredClone(raw);d.terminals[0].style=style;
    assert.equal(validate(d),false);
    assert.throws(()=>createDiagramModel(d));
  }
  for (const style of [{hidden:true},{showPortLabels:false}]) {
    const d=fixture();d.modules[0].style=style;
    assert.equal(validate(d),false);
    assert.throws(()=>createDiagramModel(d));
  }
});

test('all hidden label kinds keep identities while omitting text, backgrounds and bus notation', async () => {
  const snapshot=structuredClone(raw),model=createDiagramModel(raw),layout=await layoutDiagram(model);
  assert.deepEqual(raw,snapshot);
  assert.equal(model.modules[0].ports[0].style.hidden,true);
  assert.equal(model.modules[0].ports[1].style.hidden,false);
  assert.equal(layout.terminals[0].label,'Hidden external input');
  for (const box of [layout.terminals[0].labelBounds,layout.modules[0].labelBounds,layout.modules[0].ports[0].labelBounds,layout.groups[0].labelBounds,layout.connections[0].labelBounds]) {
    assert.equal(box.width,0);assert.equal(box.height,0);
  }
  assert.deepEqual(copyLayout(layout),layout);
  const svg=renderSvg(layout);
  for (const name of ['Hidden external input','Hidden processor name','Hidden connection name']) assert.ok(!svg.includes(name));
  assert.ok(!svg.includes('>in[7:0]<'));
  assert.ok(svg.includes('>out[7:0]<'));
  assert.ok(svg.includes('Visible output'));
  assert.ok((await sharp(Buffer.from(svg)).png().toBuffer()).length>1000);
});

test('hidden text content, size and padding consume no layout space or label warnings', async () => {
  const original=await layoutDiagram(createDiagramModel(raw)),d=structuredClone(raw);
  for (const target of [d.terminals[0],d.modules[0],d.groups[0],d.connections[0]]) {
    target.label='Long hidden label\n'.repeat(100)+'end';
    const style=target===d.terminals[0]?target.style:target.style.label;
    style.padding=500;style.fontSize=300;style.backgroundColor='#ff0000';
  }
  d.modules[0].ports[0].style={hidden:true,padding:500,fontSize:300,backgroundColor:'#ff0000'};
  const result=await layoutDiagram(createDiagramModel(d));
  assert.equal(result.width,original.width);assert.equal(result.height,original.height);
  assert.deepEqual(result.modules.map(({x,y,width,height})=>({x,y,width,height})),original.modules.map(({x,y,width,height})=>({x,y,width,height})));
  assert.deepEqual(result.warnings,original.warnings);
  assert.ok(!renderSvg(result).includes('label-background'));
});
