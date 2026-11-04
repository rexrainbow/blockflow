import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DOMParser } from '@xmldom/xmldom';
import sharp from 'sharp';
import Ajv2020 from 'ajv/dist/2020.js';
import { createDiagramModel, layoutDiagram, renderSvg } from '../../src/lib/index.js';
import { textSize } from '../../src/lib/geometry.js';
import { TEXT_STYLE } from '../../src/lib/styles.js';
import { fixture, freeze } from './helpers.js';

const schema = JSON.parse(await readFile(new URL('../../schema/blockflow.schema.json', import.meta.url), 'utf8'));
const validate = new Ajv2020({ strict: true }).compile(schema);
const inside = (a,b) => a.x >= b.x - 1e-6 && a.y >= b.y - 1e-6 && a.x+a.width <= b.x+b.width+1e-6 && a.y+a.height <= b.y+b.height+1e-6;

test('text measurement uses longest line and preserves leading, blank and trailing rows', () => {
  assert.deepEqual(textSize('abc\nx', TEXT_STYLE), {width:24,height:36});
  assert.deepEqual(textSize('\na\n\n', TEXT_STYLE), {width:8,height:72});
  assert.deepEqual(textSize('a\r\nb', TEXT_STYLE), {width:8,height:36});
});

test('display labels support LF/CRLF and normalize without mutating raw input', () => {
  const raw=fixture(); raw.modules[0].label='Input\r\nChannel A';
  raw.modules[0].ports[1].label='Data\r\nChannel A'; raw.modules[0].ports[1].width=32;
  raw.connections[0].label='data\r\n32 bits'; raw.groups=[{id:'g',label:'System\r\nInput',members:['a']}];
  assert.equal(validate(raw),true,JSON.stringify(validate.errors));
  const before=structuredClone(raw), model=createDiagramModel(freeze(raw));
  assert.deepEqual(raw,before);
  assert.equal(model.modules[0].label,'Input\nChannel A');
  assert.equal(model.modules[0].ports[1].displayName,'Data\nChannel A[31:0]');
  assert.equal(model.connections[0].label,'data\n32 bits');
  assert.equal(model.groups[0].label,'System\nInput');
  assert.equal(model.connections[0].source.portId,'o');
});

test('schema and model keep keys and document names single-line; invalid display controls rejected', () => {
  for (const value of ['', '\n\n', null, 7, 'a\tb', 'a\rb', 'a\u0000b', 'a\u2028b']) {
    for (const field of ['block','port','group','connection']) {
      const raw=fixture(); raw.groups=[{id:'g',members:['a']}];
      const target={block:raw.modules[0],port:raw.modules[0].ports[0],group:raw.groups[0],connection:raw.connections[0]}[field];
      target.label=value;
      assert.equal(validate(raw),false,field+': '+JSON.stringify(value));
      assert.throws(()=>createDiagramModel(raw));
    }
  }
  for (const change of [d=>d.diagram.name='A\nB',d=>d.modules[0].id='A\nB',d=>d.modules[0].ports[0].id='A\nB']) {
    const raw=fixture(); change(raw); assert.equal(validate(raw),false); assert.throws(()=>createDiagramModel(raw));
  }
});

for (const direction of ['right','left']) test('multiline blocks, ports, groups and edges stay inside measured geometry '+direction, async () => {
  const raw=fixture(); raw.layout={direction};
  raw.modules[0].label='Input Controller\nChannel A'; raw.modules[1].label='Output\nCollector';
  raw.modules[0].ports[1].label='Data\nChannel A'; raw.modules[0].ports[0].label='Enable\nValid\nReady';
  raw.modules[0].ports[1].width=32; raw.connections[0].label='Data bus\n32 bits';
  raw.groups=[{id:'inner',label:'Pipeline\nStage 1',members:['a']},{id:'outer',label:'System\nTop',members:['inner']}];
  const model=createDiagramModel(raw), result=await layoutDiagram(freeze(model));
  assert.equal(result.warnings,undefined);
  for (const block of result.modules) {
    assert.ok(inside(block.labelBounds,block));
    for (const port of block.ports) assert.ok(inside(port.labelBounds,block));
    assert.ok(block.labelBounds.y+block.labelBounds.height < Math.min(...block.ports.map(p=>p.labelBounds.y)));
    assert.equal(block.ports[0].y,block.ports[1].y);
  }
  for (const group of result.groups) assert.ok(inside(group.labelBounds,group));
  for (const edge of result.connections) assert.ok(inside(edge.labelBounds,{x:0,y:0,width:result.width,height:result.height}));
  const svg=renderSvg(result), xml=new DOMParser().parseFromString(svg,'image/svg+xml');
  const tspans=Array.from(xml.getElementsByTagName('tspan'));
  assert.ok(tspans.some(span=>span.textContent==='Channel A[31:0]'));
  const label=Array.from(xml.getElementsByTagName('text')).find(text=>text.textContent==='Input ControllerChannel A');
  const rows=Array.from(label.getElementsByTagName('tspan'));
  assert.equal(Number(rows[1].getAttribute('y'))-Number(rows[0].getAttribute('y')),18);
  const png=await sharp(Buffer.from(svg)).png().toBuffer(); assert.equal((await sharp(png).metadata()).format,'png');
});

test('multiline rendering preserves blank rows and escapes markup as literal text', async () => {
  const raw=fixture();raw.modules[0].label='\nA\n\n<br> & B\n';
  const svg=renderSvg(await layoutDiagram(createDiagramModel(raw)));
  assert.ok(svg.includes('&lt;br&gt; &amp; B'));
  const xml=new DOMParser().parseFromString(svg,'image/svg+xml');
  const text=Array.from(xml.getElementsByTagName('text')).find(text=>text.textContent==='A<br> & B');
  assert.equal(text.getElementsByTagName('tspan').length,5);
});

test('multiline geometry works in once layout and final outer feedback routes', async () => {
  const raw=JSON.parse(await readFile(new URL('../../examples/placement-feedback.json', import.meta.url),'utf8'));
  raw.layout.feedbackRouting='outer';
  raw.modules[0].label='Controller\nChannel A';
  raw.modules[0].ports[0].label='Return\nFeedback';
  raw.connections.forEach((edge,i)=>edge.label=`Signal ${i}\nChannel A`);
  const result=await layoutDiagram(createDiagramModel(raw));
  for(const edge of result.connections) {
    assert.ok(edge.labelBounds.height>=36);
    assert.ok(renderSvg(result).includes('<tspan'));
  }
});
