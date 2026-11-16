import orderApproval from '../../../examples/flowchart/order-approval.json';
import incidentTriage from '../../../examples/flowchart/incident-triage.json';
import batchUpdate from '../../../examples/flowchart/batch-update.json';

/** Bundled Flowchart examples (the first one is the starter on a first Flowchart visit). */
export const EXAMPLES = [
  { name: 'Order approval', document: orderApproval },
  { name: 'Incident triage (left to right)', document: incidentTriage },
  { name: 'Batch update', document: batchUpdate },
];
