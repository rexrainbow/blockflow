import { createLayoutWorker } from './worker-factory.js';

export class LayoutService {
  constructor(onResult) {
    this.onResult = onResult;
    this.revision = 0;
    this.worker = null;
    this.timer = null;
    this.busy = false;
  }

  invalidate() {
    this.revision++;
    clearTimeout(this.timer);
    if (this.busy) {
      this.worker?.terminate();
      this.worker = null;
      this.busy = false;
    }
  }

  request(document, options = {}) {
    this.invalidate();
    const revision = this.revision;
    this.timer = setTimeout(() => {
      try {
        if (!this.worker) {
          const worker = createLayoutWorker();
          this.worker = worker;
          worker.onmessage = ({ data }) => {
            if (worker !== this.worker || data.revision !== this.revision) return;
            this.busy = false;
            this.onResult(data);
          };
          worker.onerror = (event) => {
            if (worker !== this.worker) return;
            event.preventDefault();
            this.busy = false;
            worker.terminate();
            this.worker = null;
            this.onResult({
              revision: this.revision,
              error: 'Layout worker stopped. Select Re-layout to retry.',
            });
          };
        }
        this.busy = true;
        this.worker.postMessage({ document, revision, rootGroupId: options.rootGroupId ?? null });
      } catch (error) {
        this.busy = false;
        this.worker?.terminate();
        this.worker = null;
        this.onResult({ revision, error: error.message });
      }
    }, 180);
  }
}
