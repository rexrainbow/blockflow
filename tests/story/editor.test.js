import test from 'node:test';
import assert from 'node:assert/strict';
import * as gui from '../../src/story/model.js';
import * as runtime from '../../src/lib/story/model.js';
import { openInStoryEditor, receiveHandoff } from '../../src/story/handoff.js';

// Story format, checks and page sources are the runtime contract (tests/lib/story-model.test.js);
// these tests cover what the Story editor adds: its import point and the Studio hand-off.

test('the Story editor model is the runtime story contract, not a copy', () => {
  assert.deepEqual(Object.keys(gui).sort(), Object.keys(runtime).sort());
  for (const name of Object.keys(runtime)) assert.equal(gui[name], runtime[name], name);
});

// Minimal windows: message listeners, and postMessage delivering with the sender as `source`.
const fakeWindow = (href, extra = {}) => ({
  location: { href },
  listeners: new Set(),
  addEventListener(type, fn) {
    if (type === 'message') this.listeners.add(fn);
  },
  removeEventListener(type, fn) {
    if (type === 'message') this.listeners.delete(fn);
  },
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
  ...extra,
});
const deliver = (target, source, data) => queueMicrotask(() => [...target.listeners].forEach((fn) => fn({ source, data })));
const navigated = (type) => ({ getEntriesByType: () => [{ type }] });

test('the Studio hands its diagram to the Story editor tab it opened, once, by message', async () => {
  const studio = fakeWindow('http://host/app/index.html');
  const tab = fakeWindow('http://host/app/story.html', { performance: navigated('navigate') });
  // What each side holds for the other: the Studio the tab handle, the tab its opener.
  const tabHandle = { postMessage: (data) => deliver(tab, tab.opener, data) };
  tab.opener = { postMessage: (data) => deliver(studio, tabHandle, data) };
  const opened = [];
  studio.open = (url) => (opened.push(url), tabHandle);

  const message = { diagram: { modules: [] }, name: 'd.json' };
  assert.equal(openInStoryEditor(message, studio), true);
  assert.deepEqual(opened, ['http://host/app/story.html']);
  assert.equal(studio.listeners.size, 1, 'the Studio waits for the tab');
  assert.deepEqual(await receiveHandoff(tab), message);
  assert.equal(studio.listeners.size, 0, 'the Studio stops listening after the reply');
  assert.equal(tab.listeners.size, 0);

  assert.equal(openInStoryEditor(message, { ...studio, open: () => null }), false, 'a blocked tab is reported');
  assert.equal(await receiveHandoff(fakeWindow('x')), null, 'no opener: nothing to wait for');
  assert.equal(await receiveHandoff({ ...tab, performance: navigated('reload') }), null, 'a reload does not ask again');
  const silent = fakeWindow('x', { opener: { postMessage() {} } });
  assert.equal(await receiveHandoff(silent, 20), null, 'an opener that does not answer times out');
});
