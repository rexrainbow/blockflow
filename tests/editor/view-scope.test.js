import test from 'node:test';
import assert from 'node:assert/strict';
import { viewScopeOptions, validViewRoot } from '../../src/editor/state/view-scope.js';

test('view options include hidden descendants and unambiguous labels without changing the document', () => {
  const doc = {
      modules: [],
      groups: [
        { id: 'Outer', label: 'Same\nname', members: ['Child'], collapsed: true },
        { id: 'Child', label: 'Same\nname', members: [] },
      ],
    },
    before = structuredClone(doc);
  const options = viewScopeOptions(doc);
  assert.equal(options[0].value, '');
  assert.equal(options[1].value, 'Outer');
  assert.equal(options[2].value, 'Child');
  assert.deepEqual(
    options.map((option) => option.label),
    ['Top', 'Same / name [Outer]', 'Same / name [Child]'],
  );
  assert.equal(validViewRoot(doc, 'Child'), 'Child');
  assert.equal(validViewRoot(doc, 'missing'), null);
  assert.deepEqual(doc, before);
});

test('view names stay compact and disambiguate displayed names including Top', () => {
  const doc = {
    groups: [
      { id: 'CPU', members: ['Decode'] },
      { id: 'Decode', label: 'Instruction decoder', members: [] },
      { id: 'L1', label: 'Cache', members: [] },
      { id: 'L2', label: 'Cache', members: [] },
      { id: 'RootGroup', label: 'Top', members: [] },
      { id: 'Rows', label: 'Two\nlines', members: [] },
      { id: 'Flat', label: 'Two / lines', members: [] },
    ],
  };
  assert.deepEqual(
    viewScopeOptions(doc).map((option) => option.label),
    [
      'Top',
      'CPU',
      'Instruction decoder',
      'Cache [L1]',
      'Cache [L2]',
      'Top [RootGroup]',
      'Two / lines [Rows]',
      'Two / lines [Flat]',
    ],
  );
  assert.deepEqual(viewScopeOptions({}), [{ value: '', label: 'Top' }]);
});
