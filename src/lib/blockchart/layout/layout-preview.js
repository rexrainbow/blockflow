import { finishSignals } from './signals.js';
import { placeEdgeLabels } from './edge-labels.js';
import { applyConnectionArrows } from './arrows.js';
import { routeOuterFeedback } from './outer-feedback.js';

// Terminal moves can affect reserved receiver nodes. Check on
// a disposable finalized layout; routing-only signal nodes must not reach label placement.
export function labelWarnings(result, model) {
  const trial = structuredClone(result);
  if (model.layout.feedbackRouting === 'outer') routeOuterFeedback(trial, model);
  finishSignals(trial, model);
  applyConnectionArrows(trial.connections);
  return placeEdgeLabels(trial).length;
}
