import test from 'node:test';
import assert from 'node:assert/strict';
import { ViewEvents } from '../../src/lib/view/events.js';
import { createDiagramModel, layoutDiagram } from '../../src/lib/index.js';
import { exportDom, mountDiagram } from '../../src/lib/browser.js';
import * as domEntry from 'rtl-diagram/dom';
import { fixture } from './helpers.js';

test('view events deduplicate, unsubscribe and once handlers before reentrant dispatch',()=>{
  const errors=[],events=new ViewEvents(error=>errors.push(error)),calls=[];
  const handler=event=>calls.push(event.id);
  const off=events.on('blockclick',handler);events.on('blockclick',handler);
  events.once('blockclick',()=>events.emit('blockclick',{id:'nested'}));
  events.emit('blockclick',{id:'A'});assert.deepEqual(calls,['A','nested']);
  off();events.emit('blockclick',{id:'B'});assert.deepEqual(calls,['A','nested']);
  events.once('blockclick',handler);assert.equal(events.off('blockclick',handler),true);
  events.emit('blockclick',{id:'C'});assert.deepEqual(calls,['A','nested']);
  assert.deepEqual(errors,[]);
});
test('listener failures do not suppress other listeners; clear and off during dispatch take effect',()=>{
  const errors=[],events=new ViewEvents(error=>errors.push(error)),calls=[];
  const removed=()=>calls.push('removed');
  events.on('blockclick',()=>{events.off('blockclick',removed);throw new Error('application error');});
  events.on('blockclick',removed);events.on('blockclick',()=>calls.push('last'));
  events.emit('blockclick',{});assert.deepEqual(calls,['last']);assert.equal(errors[0].message,'application error');
  events.clear();events.emit('blockclick',{});assert.deepEqual(calls,['last']);
  assert.throws(()=>events.on('typo',()=>{}),/Unknown view event/);
  assert.throws(()=>events.on('portclick',null),/function/);
});
test('browser DOM exports import safely without a DOM; layout carries independently owned endpoints',async()=>{
  assert.equal(domEntry.exportDom,exportDom);assert.equal(domEntry.mountDiagram,mountDiagram);
  assert.equal(typeof exportDom,'function');assert.equal(typeof mountDiagram,'function');
  assert.throws(()=>exportDom({}),/browser Document/);
  const model=createDiagramModel(fixture()),layout=await layoutDiagram(model);
  assert.deepEqual(layout.connections[0].source,{moduleId:'a',portId:'o'});
  assert.deepEqual(layout.connections[0].target,{moduleId:'b',portId:'i'});
  assert.notEqual(layout.connections[0].source,model.connections[0].source);
});
