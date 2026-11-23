import { routeFixed } from './fixed.js';
import { routeOuterFeedback } from './outer-feedback.js';
import { routeContainerExits } from './container-exit.js';
import { routeGroupChannels } from './group-channels.js';
import { separateReceiverRails } from './receiver-rails.js';

/** Ordered policies while synthetic signal nodes and reserved envelopes still exist.
 * These passes have different eligibility and rollback rules. Do not merge them
 * into a global minimum-length search or let diagnostic text reorder policies.
 */
export function routeWorkingConnections(result, model, { grid }) {
  routeFixed(result, model, { strategy: 'container-entry' });
  if (model.layout.feedbackRouting === 'outer') routeOuterFeedback(result, model);
  if (grid) routeFixed(result, model, { strategy: 'grid-channels' });
  if (result._autoChannels.length) routeFixed(result, model, { strategy: 'auto-channels' });
  routeGroupChannels(result, model);
}

/** Semantic Nets only: preserve pinned names, source trunks and reserved channels. */
export function routeSemanticConnections(result, model) {
  routeContainerExits(result, model);
  separateReceiverRails(result, model);
}
