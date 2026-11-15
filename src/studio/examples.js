import processor from '../../examples/processor-components.json';
import nested from '../../examples/nested-groups.json';
import boundary from '../../examples/boundary-groups.json';
import collection from '../../examples/collection-instances.json';
import labels from '../../examples/connection-labels.json';
import concat from '../../examples/concat.json';
import concatFeedback from '../../examples/concat-feedback.json';
import bidirectional from '../../examples/net-bidirectional.json';
import terminals from '../../examples/terminals.json';
import vertical from '../../examples/vertical-flow.json';
import feedback from '../../examples/placement-feedback.json';
import overview from '../../examples/processor-overview.json';
import crossGrid from '../../examples/processor-cross-group-grid.json';
import partialGrid from '../../examples/partial-grid.json';
import gridChannels from '../../examples/grid-routing-channels.json';
import localSpacing from '../../examples/local-layout-spacing.json';
import autoChannels from '../../examples/auto-routing-channels.json';
import portAdjust from '../../examples/port-adjustment.json';
import appearances from '../../examples/block-appearances.json';

/**
 * Bundled examples, ordered as a short tour: structure, signals, layout, appearance.
 * Each one shows a feature the others do not. The first one is shown on a first visit.
 * e2e/studio.spec.js reads this list, so every entry is checked against the converter.
 */
export const EXAMPLES = [
  // Structure
  { name: 'Processor components', document: processor }, // overview: Down flow, nested groups, concat, terminals, caption
  { name: 'Nested groups', document: nested }, // containers inside containers, multi-line labels
  { name: 'Boundary groups', document: boundary }, // real boundary ports
  { name: 'Collection instances', document: collection }, // collections, hidden contents
  // Signals
  { name: 'Connection labels', document: labels }, // net labels, styled group frame
  { name: 'Concat', document: concat }, // ordered bus composition
  { name: 'Concat with feedback', document: concatFeedback }, // Flow-aligned bar in Down flow, feedback input
  { name: 'Bidirectional nets', document: bidirectional }, // both-direction nets, fan-out
  { name: 'External terminals', document: terminals }, // diagram inputs/outputs
  // Layout
  { name: 'Vertical flow', document: vertical }, // Down flow with mixed groups
  { name: 'Feedback placement', document: feedback }, // feedback-aware ordering
  { name: 'Grid: one cell per group', document: overview }, // each container keeps its own Grid
  { name: 'Grid: across containers', document: crossGrid }, // container blocks aligned in the parent Grid
  { name: 'Grid: with automatic blocks', document: partialGrid }, // unplaced members stay automatic
  { name: 'Grid: wire tracks', document: gridChannels }, // crowded gap widens; one track per net
  { name: 'Wire tracks in a group', document: autoChannels }, // a crowded Auto group gives each net a track
  { name: 'Spacing per group', document: localSpacing }, // a group sets its own spacing; groups inside inherit it
  { name: 'Port adjustment', document: portAdjust }, // ports slide to straighten wires
  // Appearance
  { name: 'Block shapes', document: appearances },
];
