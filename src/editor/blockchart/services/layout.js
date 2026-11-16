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
      }),
      workerError: 'Layout worker stopped. Select Re-layout to retry.',
    });
  }
}
