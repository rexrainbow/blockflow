import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiagramModel, layoutDiagram } from '../../src/lib/blockchart/index.js';
import { compactMovedFrames } from '../../src/lib/blockchart/layout/frame-compaction.js';

for (const direction of ['right', 'down'])
  for (const protectedGrid of [false, true])
    test(`frame compaction respects minimums and explicit Grids (${direction}, ${protectedGrid})`, async () => {
      const size = direction === 'right' ? 'height' : 'width';
      const raw = {
        version: 1,
        diagram: { name: 'Frame minimums' },
        layout: { direction },
        modules: [{ id: 'A', ports: [] }],
        groups: [
          {
            id: 'Parent',
            members: ['Child'],
            [size]: 6,
            ...(protectedGrid ? { layout: { type: 'grid', cells: [['Child']] } } : {}),
          },
          { id: 'Child', members: ['A'] },
        ],
      };
      const model = createDiagramModel(raw),
        layout = await layoutDiagram(model);
      const parent = layout.groups.find((g) => g.id === 'Parent'),
        child = layout.groups.find((g) => g.id === 'Child');
      const original = parent[size];
      parent[size] += 400;
      const before = new Map([[child.id, { ...child, y: child.y + 100 }]]);
      assert.equal(compactMovedFrames(layout, model, before), !protectedGrid);
      assert.equal(parent[size], protectedGrid ? original + 400 : original);
    });
