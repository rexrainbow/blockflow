import { routeFixed } from './fixed.js';
import { routeOuterFeedback } from './outer-feedback.js';
import { routeContainerExits } from './container-exit.js';
import { separateReceiverRails } from './receiver-rails.js';
import { separateApproachSpacing } from './approach-spacing.js';
import { distributeCorridorRails } from './corridor-distribution.js';

/** Ordered policies while synthetic signal nodes and reserved envelopes still exist.
 * These passes have different eligibility and rollback rules. Do not merge them
 * into a global minimum-length search or let diagnostic text reorder policies.
 */
export function routeWorkingConnections(result, model, search) {
  routeFixed(result, model, { strategy: 'container-entry', search });
  if (model.layout.feedbackRouting === 'outer') routeOuterFeedback(result, model);
  routeFixed(result, model, { strategy: 'shared-channels', search });
}

/** Semantic Nets only: preserve pinned names, source trunks and reserved channels. */
export function routeSemanticConnections(result, model) {
  routeContainerExits(result, model);
  separateReceiverRails(result, model);
  separateApproachSpacing(result, model);
  distributeCorridorRails(result, model);
}
