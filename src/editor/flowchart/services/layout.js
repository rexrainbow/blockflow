import { LayoutService as WorkerLayoutService } from '../../shared/services/layout.js';
import { createLayoutWorker } from './worker-factory.js';

export class LayoutService extends WorkerLayoutService {
  constructor(onResult) {
    super(onResult, {
      createWorker: createLayoutWorker,
      createRequest: (document, options, revision) => ({ document, revision }),
    });
  }
}
