import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DOMParser } from '@xmldom/xmldom';
import { roundedPath } from '../../src/lib/shared/rounded-path.js';
import { layoutStatechart, renderStatechartSvg } from '../../src/lib/statechart/index.js';
import { renderGraphSvg } from '../../src/lib/flowchart/render/svg.js';

test('right-angle turns round without changing endpoints or input geometry', () => {
  for (const sx of [-1, 1])
    for (const sy of [-1, 1]) {
      const points = [
        { x: 0, y: 0 },
        { x: sx * 20, y: 0 },
        { x: sx * 20, y: sy * 20 },
      ];
      const before = structuredClone(points);
      const d = roundedPath(points);
      assert.equal(d, `M 0 0 L ${sx * 12} 0 Q ${sx * 20} 0 ${sx * 20} ${sy * 8} L ${sx * 20} ${sy * 20}`);
      assert.deepEqual(points, before);
    }
});

test('adjacent corners share a short segment without overshoot', () => {
  const d = roundedPath([
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 20, y: 4 },
    { x: 40, y: 4 },
  ]);
  assert.equal(d, 'M 0 0 L 18 0 Q 20 0 20 2 L 20 2 Q 20 4 22 4 L 40 4');
});

test('straight, repeated, reversing and single-point paths stay finite', () => {
  assert.equal(
    roundedPath([
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 20, y: 0 },
    ]),
    'M 0 0 L 20 0',
  );
  assert.equal(
    roundedPath([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 40, y: 0 },
    ]),
    'M 0 0 L 20 0 L 40 0',
  );
  assert.equal(
    roundedPath([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 0, y: 0 },
    ]),
    'M 0 0 L 20 0 L 0 0',
  );
  assert.equal(roundedPath([{ x: 0, y: 0 }]), 'M 0 0');
  assert.equal(roundedPath([]), '');
});

test('rounding leaves a straight final run for the existing arrowhead', () => {
  const points = [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 20, y: 10 },
  ];
  assert.equal(roundedPath(points, { endClearance: 8 }), 'M 0 0 L 18 0 Q 20 0 20 2 L 20 10');
  assert.equal(roundedPath(points, { endClearance: 10 }), 'M 0 0 L 20 0 L 20 10');
});

test('a nearby obstacle shrinks a corner instead of sweeping into it', () => {
  const d = roundedPath(
    [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
    ],
    {
      obstacles: [{ x: 13, y: 4, width: 2, height: 2 }],
    },
  );
  assert.equal(d, 'M 0 0 L 16 0 Q 20 0 20 4 L 20 20');
});

const document = JSON.parse(
  await readFile(new URL('../../examples/statechart/task-controller.json', import.meta.url), 'utf8'),
);
const edgeGroups = (svg) =>
  [...new DOMParser().parseFromString(svg, 'image/svg+xml').getElementsByTagName('g')].filter(
    (g) => g.getAttribute('data-role') === 'flow-edge',
  );

test('Statechart curves preserve layout, endpoints, arrows and label clearance; Flowchart stays angular', async () => {
  const input = structuredClone(document);
  input.transitions.push({ from: 'Running', to: 'Running', label: 'Repeat locally' });
  const layout = await layoutStatechart(input),
    before = structuredClone(layout);
  const svg = renderStatechartSvg(layout);
  const angular = renderGraphSvg({ ...layout, nodes: [], edges: layout.transitions, groups: [] });
  const groups = edgeGroups(svg),
    original = edgeGroups(angular);
  let curves = 0;
  for (let i = 0; i < groups.length; i++) {
    const d = groups[i].getElementsByTagName('path')[0].getAttribute('d');
    const old = original[i].getElementsByTagName('path')[0].getAttribute('d');
    assert.doesNotMatch(old, /\bQ\b/);
    assert.equal(
      groups[i].getElementsByTagName('polygon')[0]?.getAttribute('points'),
      original[i].getElementsByTagName('polygon')[0]?.getAttribute('points'),
    );
    const points = layout.transitions[i].sections[0].points;
    assert.ok(d.startsWith(`M ${points[0].x} ${points[0].y}`));
    assert.ok(d.endsWith(`L ${points.at(-1).x} ${points.at(-1).y}`));
    const tokens = d.match(/[MLQ]|-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi);
    let x = 0,
      y = 0;
    for (let j = 0; j < tokens.length;) {
      const command = tokens[j++];
      if (command === 'M' || command === 'L') {
        x = Number(tokens[j++]);
        y = Number(tokens[j++]);
        continue;
      }
      assert.equal(command, 'Q');
      curves++;
      const cx = Number(tokens[j++]),
        cy = Number(tokens[j++]),
        ex = Number(tokens[j++]),
        ey = Number(tokens[j++]);
      for (let k = 0; k <= 20; k++) {
        const t = k / 20,
          u = 1 - t,
          px = u * u * x + 2 * u * t * cx + t * t * ex,
          py = u * u * y + 2 * u * t * cy + t * t * ey;
        assert.ok(px >= 0 && py >= 0 && px <= layout.width && py <= layout.height);
        for (const edge of layout.transitions.filter((e) => e.labelBounds)) {
          const b = edge.labelBounds;
          assert.ok(
            !(px > b.x && px < b.x + b.width && py > b.y && py < b.y + b.height),
            'curve enters label',
          );
        }
      }
      x = ex;
      y = ey;
    }
  }
  assert.ok(curves > 0);
  assert.deepEqual(layout, before);
  assert.equal(renderStatechartSvg(layout), svg);
});
