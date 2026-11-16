export function createLayoutWorker() {
  return new Worker(new URL('../workers/layout.js', import.meta.url), { type: 'module' });
}
