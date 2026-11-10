import { button, field, input, select, textarea, escape as e, feedbackControl, sortActions } from './ui.js';
import { endpoints, targetReason, connectionKey } from '../state/commands.js';
import { endpointKey, endpointLabel } from '../../lib/blockchart/endpoints.js';
import { targetEntries, targetEndpoint, targetEndpoints } from '../../lib/blockchart/nets.js';

export function renderNetRow(document, net, index, position, count) {
  const sources = endpoints(document, 'output').map((p) => ({ value: p.ref, label: p.label }));
  const entries = targetEntries(net),
    keys = targetEndpoints(net).map(endpointKey);
  const targets = entries
    .map((entry, j) => {
      const options = endpoints(document, 'input').map((p) => {
        const reason = keys.some((key, k) => k !== j && key === p.ref)
          ? 'Already in this Net'
          : targetReason(document, net.from, p.ref, index, net.direction);
        return { value: p.ref, label: p.label + (reason ? ' (' + reason + ')' : ''), disabled: !!reason };
      });
      return `<div class="net-target" data-branch-index="${j}">${field('Target ' + (j + 1), select(options, endpointKey(targetEndpoint(entry)), `data-field="connection-to" data-index="${index}" data-target-index="${j}" data-focus-key="to-${index}-${j}" aria-label="Connection ${index + 1} target ${j + 1}"`))}${button('remove-net-target', 'Remove target', { className: 'text-button', disabled: entries.length === 1, attrs: `data-index="${index}" data-target-index="${j}"`, ariaLabel: `Remove target ${j + 1} from Connection ${index + 1}` })}<label class="check-label"><input type="checkbox" data-field="net-target-constraint" data-index="${index}" data-target-index="${j}" data-focus-key="constraint-${index}-${j}" ${(entry?.constraint ?? net.constraint) !== false ? 'checked' : ''}/>Affect placement</label>${feedbackControl(entry?.feedback ?? net.feedback ?? false, `data-field="net-target-feedback" data-index="${index}" data-target-index="${j}" data-focus-key="target-feedback-${index}-${j}" aria-label="Target ${j + 1} feedback"`)}${button('edit-style', 'Style', { className: 'text-button', ariaLabel: `Target ${j + 1} style`, attrs: `data-style-kind="connection" data-connection="${index}" data-target-index="${j}"` })}</div>`;
    })
    .join('');
  return `<div class="connection-row" data-drop-kind="connection" data-index="${index}" data-edge-key="${e(connectionKey(net))}" role="group" aria-label="Net ${e(net.label ?? net.id ?? net.from)}" tabindex="0">
    ${field('Key (ID)', input(net.id ?? '', `data-field="connection-id" data-index="${index}" data-focus-key="net-id-${index}" aria-label="Connection ${index + 1} key" placeholder="Automatic"`))}
    ${field('Main endpoint', select(sources, endpointKey(net.from), `data-field="connection-from" data-index="${index}" data-focus-key="from-${index}" aria-label="Connection ${index + 1} main endpoint"`))}
    ${field('Label', textarea(net.label ?? '', `data-field="connection-label" data-index="${index}" data-focus-key="connection-label-${index}" aria-label="Connection ${index + 1} label" placeholder="Optional"`))}
    <label class="check-label"><input type="checkbox" data-field="net-bidirectional" data-index="${index}" data-focus-key="bidirectional-${index}" ${net.direction === 'both' ? 'checked' : ''}/>Bidirectional</label>
    <div class="net-targets">${targets}</div>${button('add-net-target', 'Add target', { className: 'text-button', attrs: `data-index="${index}"` })}
    <div class="connection-row-bottom">${sortActions('connection', position, count, `data-connection="${index}"`)}${feedbackControl(net.feedback, `data-field="connection-feedback" data-index="${index}" data-focus-key="feedback-${index}"`)}</div>
    ${button('edit-style', 'Style', { className: 'text-button connection-style-button', ariaLabel: `Connection style: ${endpointLabel(net.from)} to ${endpointLabel(net.to)}`, attrs: `data-style-kind="connection" data-connection="${index}"` })}
  </div>`;
}

export function renderNetDialog(document, draft = {}) {
  const mode = draft.mode ?? 'net',
    sources = endpoints(document, 'output').map((p) => ({ value: p.ref, label: p.label }));
  const sourceValues = draft.sources ?? [draft.from ?? sources[0]?.value ?? ''];
  const targets = draft.targets ?? [draft.to ?? ''];
  return `<form novalidate><div class="dialog-heading"><h2 id="dialog-title">Add connection</h2><p>Net shares one signal with one or more targets. Concat combines inputs into a separate element. Bidirectional interfaces require inout ports.</p></div>
    ${field(
      'Connection mode',
      select(
        [
          { value: 'net', label: 'Net' },
          { value: 'concat', label: 'Concat' },
        ],
        mode,
        'id="dialog-mode" data-field="dialog-mode"',
      ),
    )}
    ${sourceValues.map((value, j) => (j ? button('dialog-remove-source', 'Remove source ' + (j + 1), { className: 'text-button', attrs: `data-index="${j}"` }) : '') + field(mode === 'concat' ? 'Source ' + (j + 1) : 'Main endpoint', select(sources, value, `id="${j ? 'dialog-source-' + j : 'dialog-source'}" data-net-source data-field="dialog-source" aria-label="${mode === 'concat' ? 'Source ' + (j + 1) : 'Main endpoint'}"`))).join('')}
    ${mode === 'concat' ? button('dialog-add-source', 'Add source', { className: 'text-button' }) : ''}
    ${targets.map((value, j) => (j ? button('dialog-remove-target', 'Remove target ' + (j + 1), { className: 'text-button', attrs: `data-index="${j}"` }) : '') + field('Target ' + (j + 1), `<select id="${j ? 'dialog-target-' + j : 'dialog-target'}" data-net-target data-field="dialog-target" aria-label="Target ${j + 1}" data-preferred="${e(value)}"></select>`)).join('')}
    ${button('dialog-add-target', 'Add target', { className: 'text-button' })}
    ${button('connection-terminal', 'New external input…', { className: 'text-button', attrs: 'data-direction="input"' })}${button('connection-terminal', 'New external output…', { className: 'text-button', attrs: 'data-direction="output"' })}
    ${field('Label', textarea(draft.label ?? '', 'id="dialog-label" placeholder="Optional"'))}
    <label class="check-label"><input type="checkbox" id="dialog-bidirectional" data-field="dialog-bidirectional" ${draft.direction === 'both' ? 'checked' : ''} ${mode === 'concat' ? 'disabled' : ''}/>Bidirectional</label>
    <label class="check-label"><input type="checkbox" id="dialog-constraint" ${draft.constraint !== false ? 'checked' : ''}/>Affect placement</label>
    ${feedbackControl(draft.feedback ?? false, 'id="dialog-feedback"')}
    <p id="dialog-error" class="field-error" role="alert"></p><footer class="dialog-actions">${button('cancel-dialog', 'Cancel', { className: 'outline' })}${button('confirm-connection', 'Add connection', { className: 'primary' })}</footer></form>`;
}
