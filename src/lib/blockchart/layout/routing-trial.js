import { routeFixed } from './fixed.js';

/** Evaluate a disposable, already-edited working copy; keep baseline on search failure.
 * Acceptance policies remain with the feature. Cloning stays with the caller so
 * it can validate proposed geometry before paying for routing. Never use for the
 * required baseline route: those failures must reach DiagramLayoutError.
 */
export function evaluateRoutedTrial(
  trial,
  model,
  { selected = null, reason = null, routeOptions, route = routeFixed, accept = () => true } = {},
) {
  try {
    route(trial, model, { ...routeOptions, selected, reason });
  } catch {
    return false;
  }
  return accept(trial);
}

/** Publish an accepted optional trial; evaluation can also be used independently
 * to compare route alternatives at the same already-chosen anchor placement. */
export function commitRoutedTrial(result, trial, model, options = {}) {
  if (!evaluateRoutedTrial(trial, model, options)) return false;
  Object.assign(result, trial);
  return true;
}
