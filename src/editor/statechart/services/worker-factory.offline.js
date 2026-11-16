import InlineLayoutWorker from '../workers/layout.js?worker&inline';
export function createLayoutWorker() {
  return new InlineLayoutWorker();
}
