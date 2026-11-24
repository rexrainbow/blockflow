import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDiagramModel, layoutDiagram } from '../../src/lib/blockchart/index.js';
const source = JSON.parse(
  readFileSync(new URL('../fixtures/blockchart/scoped-peripheral-input.json', import.meta.url), 'utf8'),
);
for (const rootGroupId of [undefined, 'Device'])
  test(`peripheral source follows real receiver anchors across label widths (${rootGroupId ?? 'Top'})`, async () => {
    const outputs = [];
    for (const firstLine of [
      'Overlay input signa',
      'Overlay input signal',
      'Overlay input signalX',
      'Overlay input signal ABCD',
      'Overlay input signal ABCDEFGHIJKLMNOPQRSTUVWX',
    ]) {
      const raw = structuredClone(source);
      raw.modules.find((n) => n.id === 'SerialInput').label = firstLine + '\nNRZI data';
      const model = createDiagramModel(raw),
        before = structuredClone(raw),
        saved = structuredClone(model),
        r = await layoutDiagram(model, { rootGroupId });
      const anchor = (id, port) => r.modules.find((n) => n.id === id).ports.find((p) => p.id === port).y;
      const input = r.modules.find((n) => n.id === 'SerialInput'),
        targets = [anchor('ReceiveEvent', 'overlay'), anchor('CaptureQueue', 'data')];
      const actual = anchor('SerialInput', 'output'),
        goal = (targets[0] + targets[1]) / 2;
      assert.ok(
        Math.abs(actual - goal) < 1e-6,
        `${firstLine}: ${actual} should follow ${goal}, width ${input.width}`,
      );
      assert.deepEqual(raw, before);
      assert.deepEqual(model, saved);
      outputs.push({ y: input.y, height: input.height, actual, goal });
    }
    for (const output of outputs) assert.deepEqual(output, outputs[0]);
  });
