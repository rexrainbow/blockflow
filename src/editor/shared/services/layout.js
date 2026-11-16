/** Diagram-independent scheduling; diagram editors inject factories and payloads. */
export class LayoutService {
  constructor(
    onResult,
    {
      createWorker,
      createRequest = (document, options, revision) => ({ ...options, document, revision }),
      debounceMs = 180,
      workerError = 'Layout worker stopped.',
    } = {},
  ) {
    if (
      typeof onResult !== 'function' ||
      typeof createWorker !== 'function' ||
      typeof createRequest !== 'function'
    )
      throw new TypeError('LayoutService requires a result callback, worker factory and request adapter.');
    if (typeof debounceMs !== 'number' || !Number.isFinite(debounceMs) || debounceMs < 0)
      throw new RangeError('Layout debounce must be finite and non-negative.');
    this.onResult = onResult;
    this.createWorker = createWorker;
    this.createRequest = createRequest;
    this.debounceMs = debounceMs;
    this.workerError = workerError;
    this.revision = 0;
    this.worker = null;
    this.timer = null;
    this.busy = false;
    this.disposed = false;
  }

  invalidate() {
    this.revision++;
    clearTimeout(this.timer);
    this.timer = null;
    if (this.busy) {
      this.worker?.terminate();
      this.worker = null;
      this.busy = false;
    }
  }

  request(document, options = {}) {
    if (this.disposed) throw new Error('LayoutService has been disposed.');
    this.invalidate();
    const revision = this.revision;
    this.timer = setTimeout(() => {
      this.timer = null;
      try {
        if (!this.worker) {
          const worker = this.createWorker();
          this.worker = worker;
          worker.onmessage = ({ data }) => {
            if (worker !== this.worker || data?.revision !== this.revision) return;
            this.busy = false;
            this.onResult(data);
          };
          worker.onerror = (event) => {
            if (worker !== this.worker) return;
            event.preventDefault?.();
            this.busy = false;
            worker.terminate();
            this.worker = null;
            this.onResult({ revision: this.revision, error: this.workerError });
          };
        }
        this.busy = true;
        this.worker.postMessage(this.createRequest(document, options, revision));
      } catch (error) {
        this.busy = false;
        this.worker?.terminate();
        this.worker = null;
        this.onResult({ revision, error: error?.message ?? String(error) });
      }
    }, this.debounceMs);
  }

  /** End a session, including its cached idle worker. */
  dispose() {
    if (this.disposed) return;
    this.invalidate();
    this.worker?.terminate();
    this.worker = null;
    this.busy = false;
    this.disposed = true;
  }
}
