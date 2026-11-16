import test from 'node:test';
import assert from 'node:assert/strict';
import { LayoutService } from '../../../src/editor/shared/services/layout.js';

function harness(t, extra = {}) {
  const workers = [],
    messages = [];
  let wake;
  let next = new Promise((resolve) => {
    wake = resolve;
  });
  const createWorker = () => {
    const worker = {
      terminated: 0,
      jobs: [],
      terminate() {
        this.terminated++;
      },
      postMessage(job) {
        this.jobs.push(job);
        wake({ worker, job });
      },
    };
    workers.push(worker);
    return worker;
  };
  const service = new LayoutService((data) => messages.push(data), { createWorker, debounceMs: 0, ...extra });
  t.after(() => service.dispose());
  return {
    service,
    workers,
    messages,
    job: async () => {
      const result = await next;
      next = new Promise((resolve) => {
        wake = resolve;
      });
      return result;
    },
  };
}
test(
  'generic scheduling debounces superseded requests and reuses an idle worker',
  { timeout: 3000 },
  async (t) => {
    const h = harness(t);
    h.service.request({ nodes: ['old'] });
    h.service.request({ nodes: ['current'] }, { format: 'flowchart', revision: -1 });
    const { worker, job } = await h.job();
    assert.equal(h.workers.length, 1);
    assert.deepEqual(job, { format: 'flowchart', document: { nodes: ['current'] }, revision: 2 });
    assert.equal(h.service.busy, true);
    worker.onmessage({ data: null });
    worker.onmessage({ data: { revision: 1, layout: 'stale' } });
    assert.deepEqual(h.messages, []);
    worker.onmessage({ data: { revision: 2, layout: 'accepted' } });
    assert.equal(h.service.busy, false);
    h.service.request({ nodes: ['next'] });
    const second = await h.job();
    assert.equal(second.worker, worker);
    assert.equal(second.job.revision, 3);
    assert.equal(worker.terminated, 0);
  },
);
test(
  'busy work is terminated and old worker results/errors cannot affect a replacement',
  { timeout: 3000 },
  async (t) => {
    const h = harness(t);
    h.service.request({ nodes: [1] });
    const old = await h.job();
    h.service.request({ nodes: [2] });
    assert.equal(old.worker.terminated, 1);
    const current = await h.job();
    assert.notEqual(current.worker, old.worker);
    old.worker.onmessage({ data: { revision: current.job.revision, layout: 'wrong worker' } });
    old.worker.onerror({
      preventDefault() {
        throw new Error('stale error');
      },
    });
    assert.deepEqual(h.messages, []);
    assert.equal(h.service.busy, true);
    current.worker.onmessage({ data: { revision: current.job.revision, layout: 'new' } });
    assert.equal(h.messages.length, 1);
    assert.equal(h.service.busy, false);
  },
);
test('worker errors release the worker and the next request can recover', { timeout: 3000 }, async (t) => {
  const h = harness(t);
  h.service.request({});
  const first = await h.job();
  let prevented = false;
  first.worker.onerror({
    preventDefault() {
      prevented = true;
    },
  });
  assert.equal(prevented, true);
  assert.equal(first.worker.terminated, 1);
  assert.deepEqual(h.messages, [{ revision: 1, error: 'Layout worker stopped.' }]);
  h.service.request({});
  const next = await h.job();
  assert.notEqual(first.worker, next.worker);
});
test(
  'request adapters can preserve a domain protocol and synchronous failures are reported',
  { timeout: 3000 },
  async (t) => {
    const h = harness(t, {
      createRequest: (document, options, revision) => ({ document, revision, view: options.view ?? null }),
    });
    h.service.request({ steps: [] }, { view: 'detail' });
    const first = await h.job();
    assert.deepEqual(first.job, { document: { steps: [] }, revision: 1, view: 'detail' });
    first.worker.onmessage({ data: { revision: 1 } });
    const failure = await new Promise((resolve) => {
      const s = new LayoutService(resolve, {
        createWorker: () => {
          throw new Error('factory failure');
        },
        debounceMs: 0,
      });
      t.after(() => s.dispose());
      s.request({});
    });
    assert.deepEqual(failure, { revision: 1, error: 'factory failure' });
  },
);
test(
  'dispose cancels pending timers, closes idle workers and rejects later requests',
  { timeout: 3000 },
  async (t) => {
    const h = harness(t);
    h.service.request({});
    const { worker, job } = await h.job();
    worker.onmessage({ data: { revision: job.revision } });
    h.service.dispose();
    h.service.dispose();
    assert.equal(worker.terminated, 1);
    assert.equal(h.service.worker, null);
    worker.onmessage({ data: { revision: h.service.revision } });
    assert.equal(h.messages.length, 1);
    assert.throws(() => h.service.request({}), /disposed/);
    let created = 0;
    const pending = new LayoutService(() => {}, {
      createWorker: () => {
        created++;
        throw new Error('not reached');
      },
      debounceMs: 1000,
    });
    pending.request({});
    pending.dispose();
    assert.equal(pending.timer, null);
    assert.equal(created, 0);
  },
);

for (const failure of ['payload', 'postMessage'])
  test(`${failure} exceptions close the worker and retain revision`, { timeout: 3000 }, async (t) => {
    let terminated = 0;
    const data = await new Promise((resolve) => {
      const service = new LayoutService(resolve, {
        debounceMs: 0,
        createWorker: () => ({
          terminate() {
            terminated++;
          },
          postMessage() {
            if (failure === 'postMessage') throw new Error('post failed');
          },
        }),
        createRequest: (document, options, revision) => {
          if (failure === 'payload') throw new Error('payload failed');
          return { document, revision };
        },
      });
      t.after(() => service.dispose());
      service.request({});
    });
    assert.equal(data.revision, 1);
    assert.match(data.error, /failed/);
    assert.equal(terminated, 1);
  });
