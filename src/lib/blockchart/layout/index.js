import ELK from 'elkjs/lib/elk.bundled.js';
import { scopeModel } from './scope.js';
import { visibleModel } from './visibility.js';
import { signalModel, finishSignals, receiverLabels } from './signals.js';
import { buildElkGraph } from './elk-graph.js';
import { readElkResult } from './elk-result.js';
import { preserveGroupPortOrder } from './groups.js';
import { arrangeGrids } from './grid-layout.js';
import { routeFixed } from './fixed.js';
import { alignTerminals } from './terminal-alignment.js';
import { alignReceivers } from './receiver-layout.js';
import { adjustPorts } from './port-adjustment.js';
import { routeOuterFeedback } from './outer-feedback.js';
import { finalizeLayout } from './finalize.js';

export class DiagramLayoutError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'DiagramLayoutError';
  }
}

/** One complete pass; synthetic nodes stay present until every geometry adjustment finishes. */
async function layoutPass(input, receivers) {
  const model = signalModel(input, receivers);
  const elk = new ELK();
  const result = readElkResult(await elk.layout(buildElkGraph(model)), model);

  preserveGroupPortOrder(result.groups, result.connections, model.layout.direction);
  const grid =
    (!model.rootGroupId && model.layout.type === 'grid') ||
    model.groups.some((group) => !group.collapsed && group.layout?.type === 'grid');
  if (grid) {
    await arrangeGrids(result, model, elk);
    routeFixed(result, model);
  } else if (model.connections.some((edge) => edge.constraint === false)) {
    routeFixed(result, model, true);
  }

  alignTerminals(result, model);
  alignReceivers(result, model);
  adjustPorts(result, model);
  if (model.layout.feedbackRouting === 'outer') routeOuterFeedback(result, model);

  finishSignals(result, model);
  const layout = finalizeLayout(result, model);
  return model.rootGroupId ? { ...layout, rootGroupId: model.rootGroupId } : layout;
}

/** Scope and project once; Auto receiver labels may request exactly one additional pass. */
export async function layoutDiagram(model, options = {}) {
  try {
    model = visibleModel(scopeModel(model, options.rootGroupId));
    const selected = receiverLabels(model);
    const first = await layoutPass(model, selected);
    const final = receiverLabels(model, first);
    return await ([...final].some((id) => !selected.has(id)) ? layoutPass(model, final) : first);
  } catch (cause) {
    if (cause instanceof DiagramLayoutError) throw cause;
    throw new DiagramLayoutError(`Layout failed: ${cause.message}`, { cause });
  }
}
