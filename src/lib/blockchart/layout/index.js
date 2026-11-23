import { scopeModel } from './scope.js';
import { visibleModel } from './visibility.js';
import { receiverLabels } from './signals.js';
import { layoutPass } from './pipeline.js';
import { withGridBlockMinimums } from './grid-minimums.js';

export class DiagramLayoutError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'DiagramLayoutError';
  }
}

/** Scope and project once; Auto receiver labels may request exactly one additional pass. */
export async function layoutDiagram(model, options = {}) {
  try {
    model = visibleModel(scopeModel(withGridBlockMinimums(model), options.rootGroupId));
    const selected = receiverLabels(model);
    const first = await layoutPass(model, selected);
    const final = receiverLabels(model, first);
    return await ([...final].some((id) => !selected.has(id)) ? layoutPass(model, final) : first);
  } catch (cause) {
    if (cause instanceof DiagramLayoutError) throw cause;
    throw new DiagramLayoutError(`Layout failed: ${cause.message}`, { cause });
  }
}
