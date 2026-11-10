// Internal facade: keep signal compilation, selection and restoration independently readable.
export { signalModel } from './signals/compile.js';
export { finishSignals } from './signals/restore.js';
export { routeLength, receiverLabels } from './signals/selection.js';
