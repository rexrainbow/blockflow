import ELK from 'elkjs/lib/elk.bundled.js';
import { signalModel, finishSignals } from './signals.js';
import { buildElkGraph } from './elk-graph.js';
import { readElkResult } from './elk-result.js';
import { restoreConcatAnchors } from './concat-anchors.js';
import { preserveGroupPortOrder } from './groups.js';
import { arrangeGrids } from './grid-layout.js';
import { routeFixed } from './fixed.js';
import { planAutoChannels } from './auto-channels.js';
import { alignTerminals } from './terminal-alignment.js';
import { alignReceivers } from './receiver-layout.js';
import { adjustPorts } from './port-adjustment.js';
import { finalizeLayout } from './finalize.js';
import { routeWorkingConnections, routeSemanticConnections } from './routing-policy.js';
import { alignPeripheralGroups } from './peripheral-alignment.js';

// Required stage order. Working signal nodes survive through placement and routing.
// These phases are deliberately explicit: route repairs within a phase are needed
// for subsequent geometry scoring; they are not independent passes to reorder.

/** Establish node geometry and valid baseline routes (Grid, Concat, weak edges). */
async function placeNodes({ result, model, elk, grid }) {
  const concatEdges = restoreConcatAnchors(result, model);
  preserveGroupPortOrder(result.groups, result.connections, model.layout.direction);
  if (grid) {
    await arrangeGrids(result, model, elk);
    routeFixed(result, model);
  } else {
    if (model.connections.some((edge) => edge.constraint === false)) {
      routeFixed(result, model, { onlyExcluded: true });
      for (const edge of model.connections) if (edge.constraint === false) concatEdges.delete(edge.id);
    }
    if (concatEdges.size) routeFixed(result, model, { selected: concatEdges, reason: 'concat-anchors' });
  }
}

/** Refine geometry with bounded route trials; owned signal nodes move with owners. */
function refineAnchors({ result, model, grid }) {
  if (grid) alignPeripheralGroups(result, model);
  if (planAutoChannels(result, model)) routeFixed(result, model);
  alignTerminals(result, model);
  alignReceivers(result, model);
  adjustPorts(result, model);
}

/** Freeze anchors; apply entry, outer-feedback and reserved channels in that order. */
function routeConnections({ result, model }) {
  routeWorkingConnections(result, model);
}

/** Restore semantic Nets, repair exits with labels pinned, then publish coordinates. */
function completeLayout({ result, model }) {
  finishSignals(result, model);
  routeSemanticConnections(result, model);
  const layout = finalizeLayout(result, model);
  return model.rootGroupId ? { ...layout, rootGroupId: model.rootGroupId } : layout;
}

/** One pass over a private compiled model; authoring data is never mutated. */
export async function layoutPass(input, receivers) {
  const model = signalModel(input, receivers);
  const elk = new ELK();
  const result = readElkResult(await elk.layout(buildElkGraph(model)), model);
  const grid =
    (!model.rootGroupId && model.layout.type === 'grid') ||
    model.groups.some((group) => !group.collapsed && group.layout?.type === 'grid');
  const context = { model, elk, result, grid };
  await placeNodes(context);
  refineAnchors(context);
  routeConnections(context);
  return completeLayout(context);
}
