import InlineLayoutWorker from '../workers/layout.js?worker&inline';

/** File build: Vite embeds the complete IIFE worker and creates a Blob worker. */
export function createLayoutWorker() {
  return new InlineLayoutWorker();
}
