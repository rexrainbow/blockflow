import test from 'node:test';
import assert from 'node:assert/strict';
import {
  newDefaultsDraft,
  defaultsDirty,
  defaultsStyle,
  defaultFieldHint,
} from '../../src/editor/state/defaults.js';
const document = { diagram: { style: { text: { fontSize: 16 }, module: { portLabel: { fontSize: 18 } } } } };

test('Defaults drafts preserve omitted properties and recover edits across categories without changing the document', () => {
  const before = structuredClone(document),
    d = newDefaultsDraft(document);
  assert.equal(defaultsDirty(d), false);
  d.inputs['text//fontSize'] = { value: '20' };
  d.category = 'connection';
  d.section = 'label';
  d.inputs['connection/label/fontSize'] = { value: '24' };
  assert.equal(defaultsDirty(d), true);
  assert.deepEqual(document, before);
  const recovered = newDefaultsDraft(document, JSON.parse(JSON.stringify(d)));
  assert.equal(recovered.category, 'connection');
  assert.equal(defaultsStyle(recovered).connection.label.fontSize, 24);
  assert.deepEqual(newDefaultsDraft({ diagram: { style: { text: { fontSize: 30 } } } }, d).inputs, {});
});

test('Inheritance hints exclude the edited property, and clearing overrides restores the next layer', () => {
  const d = newDefaultsDraft(document);
  d.category = 'module';
  d.section = 'inputPortLabel';
  d.inputs['module/inputPortLabel/fontSize'] = { value: '22' };
  assert.deepEqual(defaultFieldHint(d, 'inputPortLabel', 'fontSize'), {
    value: 18,
    source: 'Diagram > Blocks > All ports',
  });
  d.inputs['module/inputPortLabel/fontSize'] = { value: '' };
  assert.equal(defaultsStyle(d).module.inputPortLabel, undefined);
  d.inputs['text//fontSize'] = { value: '' };
  d.inputs['terminal//padding'] = { value: '0' };
  d.inputs['terminal//hidden'] = { value: 'false' };
  const style = defaultsStyle(d);
  assert.equal(style.text, undefined);
  assert.deepEqual(style.terminal, { padding: 0, hidden: false });
});

test('Apply validates all categories, identifies the invalid field, and retains the draft', () => {
  const d = newDefaultsDraft(document);
  d.inputs['text//fontSize'] = { value: '0' };
  d.category = 'connection';
  assert.throws(
    () => defaultsStyle(d),
    (error) => error.defaultsKey === 'text//fontSize',
  );
  assert.equal(d.inputs['text//fontSize'].value, '0');
  d.inputs['text//fontSize'] = { value: '', badInput: true };
  assert.throws(() => defaultsStyle(d), /valid number/);
});
