import { createStatechartModel, graphDocument } from './model.js';
import { createFlowchartModel } from '../flowchart/model.js';
import { placeStatechart, labelConflicts, StatechartLayoutError } from './label-layout.js';
import { topologyPlans, routeQuality, compareQuality } from './topology.js';

/** Label nodes exist only during placement; returned data keeps real states/transitions. */
export async function layoutStatechart(input) {
  const model = createStatechartModel(input),
    graph = createFlowchartModel(graphDocument(model));
  return checkedPlacement(model, graph, placeStatechart, topologyPlans(model, graph));
}

/** Internal retry seam: callers never receive unchecked label reservations. */
export async function checkedPlacement(model, graph, place = placeStatechart, plans = [null]) {
  let conflicts;
  let placementError;
  for (const scale of [1, 1.5, 2.25]) {
    let best;
    for (const plan of plans) {
      let layout;
      try {
        layout = await place(model, graph, scale, plan);
      } catch (error) {
        placementError = error;
        continue;
      }
      conflicts = labelConflicts(layout);
      if (conflicts.length) continue;
      const quality = routeQuality(layout);
      if (!best || compareQuality(quality, best.quality) < 0) best = { layout, quality };
    }
    if (best) return best.layout;
  }
  if (!conflicts?.length)
    throw new StatechartLayoutError(
      placementError?.message ?? 'No valid placement candidate.',
      placementError?.path ?? '',
    );
  const conflict = conflicts[0];
  const index = model.transitions.findIndex((t) => t.id === (conflict.labelId ?? conflict.edgeId));
  throw new StatechartLayoutError(
    'Could not reserve clear transition routes and labels. Increase spacing, adjust labelMaxWidth or change endpoint sides.',
    `transitions[${index}]${conflict.labelId ? '.label' : ''}`,
  );
}
