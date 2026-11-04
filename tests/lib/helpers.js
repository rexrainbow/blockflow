import assert from 'node:assert/strict';
import { moduleGeometry } from '../../src/lib/geometry.js';

export function fixture() {
  return {
    version: 1, diagram: { name: 'Test' },
    modules: [
      { id: 'a', ports: [{ id: 'i', direction: 'input' }, { id: 'o', direction: 'output' }] },
      { id: 'b', ports: [{ id: 'i', direction: 'input' }, { id: 'o', direction: 'output' }] },
    ],
    connections: [{ from: 'a.o', to: 'b.i' }],
  };
}

export function freeze(value) {
  if (value && typeof value === 'object') { Object.freeze(value); for (const child of Object.values(value)) freeze(child); }
  return value;
}

const near = (a, b) => Math.abs(a - b) < 1e-6;
function samePoint(a, b) { return near(a.x, b.x) && near(a.y, b.y); }

export function checkLayout(model, layout) {
  assert.ok(Number.isFinite(layout.width) && layout.width > 0);
  assert.ok(Number.isFinite(layout.height) && layout.height > 0);
  assert.deepEqual(layout.modules.map(m => m.id), model.modules.map(m => m.id));
  assert.deepEqual(layout.connections.map(c => c.id), model.connections.map(c => c.id));
  const anchors = new Map();
  for (const [i, module] of layout.modules.entries()) {
    assert.ok(module.width >= 140 && module.height > 0);
    assert.ok(module.x >= 0 && module.y >= 0);
    assert.ok(module.x + module.width <= layout.width + 1e-6);
    assert.ok(module.y + module.height <= layout.height + 1e-6);
    assert.deepEqual(module.ports.map(p => p.id), model.modules[i].ports.map(p => p.id));
    const geometry = moduleGeometry(model.modules[i]);
    assert.ok(samePoint(module.labelPosition, { x: module.x + module.width / 2, y: module.y + geometry.titleY }));
    for (const port of module.ports) {
      const expected = model.modules[i].ports.find(p => p.id === port.id);
      assert.ok(near(port.x, module.x + (port.direction === 'input' ? 0 : module.width)));
      assert.ok(near(port.y, module.y + geometry.rowCenters[expected.order]));
      assert.ok(near(port.labelPosition.y, port.y));
      anchors.set(`${module.id}.${port.id}`, port);
    }
  }
  for (let i = 0; i < layout.modules.length; i++) for (let j = i + 1; j < layout.modules.length; j++) {
    const a = layout.modules[i], b = layout.modules[j];
    assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y, 'modules overlap');
  }
  for (const [i, connection] of layout.connections.entries()) {
    const original = model.connections[i];
    const source = anchors.get(`${original.source.moduleId}.${original.source.portId}`);
    const target = anchors.get(`${original.target.moduleId}.${original.target.portId}`);
    assert.ok(connection.sections.length > 0);
    assert.ok(connection.sections.some(s => samePoint(s.points[0], source)), `${connection.id}: source mismatch`);
    assert.ok(connection.sections.some(s => samePoint(s.points.at(-1), target)), `${connection.id}: target mismatch`);
    for (const section of connection.sections) {
      assert.ok(section.points.length >= 2);
      for (const point of section.points) {
        assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
        assert.ok(point.x >= -1e-6 && point.x <= layout.width + 1e-6);
        assert.ok(point.y >= -1e-6 && point.y <= layout.height + 1e-6);
      }
      for (let j = 1; j < section.points.length; j++) {
        const a = section.points[j - 1], b = section.points[j];
        assert.ok(near(a.x, b.x) || near(a.y, b.y), 'non-orthogonal segment');
        for (const module of layout.modules) {
          const horizontal = near(a.y, b.y) && a.y > module.y + 1e-6 && a.y < module.y + module.height - 1e-6 && Math.max(a.x, b.x) > module.x + 1e-6 && Math.min(a.x, b.x) < module.x + module.width - 1e-6;
          const vertical = near(a.x, b.x) && a.x > module.x + 1e-6 && a.x < module.x + module.width - 1e-6 && Math.max(a.y, b.y) > module.y + 1e-6 && Math.min(a.y, b.y) < module.y + module.height - 1e-6;
          assert.ok(!horizontal && !vertical, `${connection.id} crosses ${module.id}`);
        }
      }
    }
  }
}
