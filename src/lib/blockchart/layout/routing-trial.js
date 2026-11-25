import { routeFixed } from './fixed.js';
import { routeOrthogonal } from '../../shared/orthogonal.js';

/** Share successful visibility searches between trials at one candidate position.
 * Keep the ordered geometry exact: headings and foreign rails affect the chosen
 * path even when the endpoints coincide. Callers own the points they receive.
 */
export function createCandidateRouter(search = routeOrthogonal) {
  const paths = new Map();
  return (...geometry) => {
    const key = JSON.stringify(geometry);
    let points = paths.get(key);
    if (!points) {
      points = search(...geometry);
      // Large fanouts can generate many distinct searches before the second trial.
      if (paths.size >= 256) return points;
      paths.set(key, points);
    }
    return points.map(({ x, y }) => ({ x, y }));
  };
}

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
