import { LayoutService as WorkerLayoutService } from '../../shared/services/layout.js';
import { createLayoutWorker } from './worker-factory.js';

/** Preserve the Studio constructor and Blockchart message contract. */
export class LayoutService extends WorkerLayoutService {
  constructor(onResult) {
    super(onResult, {
      createWorker: createLayoutWorker,
      createRequest: (document, options, revision) => ({
        document,
        revision,
        rootGroupId: options.rootGroupId ?? null,
        ...(options.paintOnly === true ? { paintOnly: true } : {}),
      }),
      workerError: 'Layout worker stopped. Select Re-layout to retry.',
    });
  }

  requestDelay(options) {
    return options.paintOnly === true ? 0 : this.debounceMs;
  }
}
