import { routeFixed } from './fixed.js';

/** Evaluate a disposable, already-edited working copy; keep baseline on search failure.
 * Acceptance policies remain with the feature. Cloning stays with the caller so
 * it can validate proposed geometry before paying for routing. Never use for the
 * required baseline route: those failures must reach DiagramLayoutError.
 */
export function commitRoutedTrial(
  result,
  trial,
  model,
  { selected = null, reason = null, routeOptions, accept = () => true } = {},
) {
  try {
    routeFixed(trial, model, { ...routeOptions, selected, reason });
  } catch {
    return false;
  }
  if (!accept(trial)) return false;
  Object.assign(result, trial);
  return true;
}
