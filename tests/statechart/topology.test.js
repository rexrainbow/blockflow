import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseMermaid, createStatechartModel, layoutStatechart } from '../../src/lib/statechart/index.js';
import { graphDocument } from '../../src/lib/statechart/model.js';
import { createFlowchartModel } from '../../src/lib/flowchart/model.js';
import {
  analyzeTopology,
  topologyPlans,
  routeQuality,
  compareQuality,
} from '../../src/lib/statechart/topology.js';
import { placeStatechart, labelConflicts } from '../../src/lib/statechart/label-layout.js';
import { checkedPlacement } from '../../src/lib/statechart/layout.js';
const source = await readFile(
  new URL('../../examples/statechart/label-layout/trigger-processor.mmd', import.meta.url),
  'utf8',
);
const fixture = () => createStatechartModel(parseMermaid(source));
test('topology distinguishes distinct-neighbor core, repeated-label convergence, cycles and single-owner satellites', () => {
  const model = fixture(),
    before = structuredClone(model),
    analysis = analyzeTopology(model);
  assert.deepEqual(model, before);
  assert.equal(analysis.roles.get('IDLE').role, 'convergence');
  for (const [id, owner] of [
    ['InitSkipPause', 'InitSkip'],
    ['SamplePause', 'Sample'],
    ['SkipPause', 'Skip'],
  ])
    assert.equal(analysis.satellites.get(id), owner);
  assert.deepEqual(new Set(analysis.core), new Set(['IDLE', 'InitSkip', 'Sample', 'Skip']));
  assert.ok(analysis.components.some((c) => c.length === 4));
  const plan = topologyPlans(model, createFlowchartModel(graphDocument(model)))[0];
  assert.deepEqual(plan.order.slice(0, 4), ['IDLE', 'InitSkip', 'Sample', 'Skip']);
  assert.ok(plan.backbone.has(JSON.stringify(['InitSkip', 'Sample'])));
});
test('classification does not depend on IDLE/Pause names or mistake a two-state cycle for satellites', () => {
  const model = fixture(),
    rename = new Map(model.states.map((s, i) => [s.id, `State${i}`]));
  model.states = model.states.map((s) => ({ ...s, id: rename.get(s.id) }));
  model.transitions = model.transitions.map((t) => ({
    ...t,
    from: rename.get(t.from),
    to: rename.get(t.to),
  }));
  const analysis = analyzeTopology(model);
  assert.equal(analysis.roles.get(rename.get('IDLE')).role, 'convergence');
  assert.equal(analysis.satellites.get(rename.get('SamplePause')), rename.get('Sample'));
  const pair = createStatechartModel(parseMermaid('stateDiagram-v2\nA --> B\nB --> A'));
  assert.equal(analyzeTopology(pair).satellites.size, 0);
});
test('candidate scoring counts crossings, T contacts and collinear overlap while allowing shared state ports', () => {
  const edge = (id, points, from = id + 'Source', to = id + 'Target') => ({
    id,
    from,
    to,
    sections: [{ points: points.map(([x, y]) => ({ x, y })) }],
  });
  const chart = (transitions) => ({ width: 100, height: 100, transitions });
  assert.equal(
    routeQuality(
      chart([
        edge('A', [
          [0, 10],
          [20, 10],
        ]),
        edge('B', [
          [10, 0],
          [10, 20],
        ]),
      ]),
    ).crossings,
    1,
  );
  assert.equal(
    routeQuality(
      chart([
        edge('A', [
          [0, 10],
          [20, 10],
        ]),
        edge('B', [
          [10, 10],
          [10, 20],
        ]),
      ]),
    ).crossings,
    1,
  );
  assert.equal(
    routeQuality(
      chart([
        edge('A', [
          [0, 10],
          [20, 10],
        ]),
        edge('B', [
          [10, 10],
          [30, 10],
        ]),
      ]),
    ).overlaps,
    1,
  );
  assert.equal(
    routeQuality(
      chart([
        edge(
          'A',
          [
            [0, 10],
            [20, 10],
          ],
          'Shared',
          'X',
        ),
        edge(
          'B',
          [
            [0, 10],
            [0, 30],
          ],
          'Shared',
          'Y',
        ),
      ]),
    ).crossings,
    0,
  );
  assert.ok(
    compareQuality(
      { overlaps: 0, crossings: 0, overlapLength: 0, length: 1000, bends: 5, area: 1000 },
      { overlaps: 0, crossings: 1, overlapLength: 0, length: 10, bends: 0, area: 100 },
    ) < 0,
  );
});

test('core ordering completes a strongly connected circuit before its one-way exit', () => {
  const model = createStatechartModel(parseMermaid('stateDiagram-v2\nA --> B\nB --> C\nC --> A\nB --> End'));
  const plan = topologyPlans(model, createFlowchartModel(graphDocument(model)))[0];
  for (const id of ['A', 'B', 'C']) assert.ok(plan.order.indexOf(id) < plan.order.indexOf('End'));
});
test('core-first selection removes the reported crossing without losing labels, state IDs or transition identities', async () => {
  const model = fixture(),
    before = structuredClone(model),
    graph = createFlowchartModel(graphDocument(model));
  const baseline = await placeStatechart(model, graph),
    selected = await layoutStatechart(model);
  assert.equal(routeQuality(baseline).crossings, 1);
  assert.equal(routeQuality(selected).crossings, 0);
  assert.equal(routeQuality(selected).overlaps, 0);
  assert.deepEqual(labelConflicts(selected), []);
  assert.deepEqual(model, before);
  assert.deepEqual(
    selected.states.map((s) => s.id),
    model.states.map((s) => s.id),
  );
  assert.deepEqual(
    selected.transitions.map((t) => [t.id, t.from, t.to, t.label]),
    baseline.transitions.map((t) => [t.id, t.from, t.to, t.label]),
  );
  assert.deepEqual(await layoutStatechart(model), selected);
});
test('a rejected or failed topology candidate cannot displace a valid declaration candidate', async () => {
  const model = createStatechartModel(parseMermaid('stateDiagram-v2\nA --> B: ready')),
    good = await layoutStatechart(model);
  const plans = [{ name: 'failed' }, { name: 'unsafe' }, { name: 'declaration', baseline: true }],
    bad = structuredClone(good),
    box = bad.transitions[0].labelBounds;
  bad.transitions.push({
    id: 'foreign',
    style: { strokeWidth: 1 },
    sections: [
      {
        points: [
          { x: box.x - 10, y: box.y + box.height / 2 },
          { x: box.x + box.width + 10, y: box.y + box.height / 2 },
        ],
      },
    ],
  });
  const seen = [];
  const layout = await checkedPlacement(
    model,
    {},
    async (_model, _graph, scale, plan) => {
      seen.push([scale, plan.name]);
      if (plan.name === 'failed') throw new Error('candidate failure');
      return plan.name === 'unsafe' ? bad : good;
    },
    plans,
  );
  assert.equal(layout, good);
  assert.deepEqual(
    seen.map((s) => s[1]),
    ['failed', 'unsafe', 'declaration'],
  );
});
