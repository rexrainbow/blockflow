/** Server build: keep the layout engine in a separate module worker. */
export function createLayoutWorker() {
  return new Worker(new URL('../workers/layout.js', import.meta.url), { type: 'module' });
}
