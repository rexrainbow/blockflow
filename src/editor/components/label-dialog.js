import { button, escape as e, field, textarea } from './ui.js';

export function renderLabelDialog(item, kind) {
  const connection = kind === 'connection';
  const help = connection ? 'Leave blank to remove the label.' : 'Leave blank to display the key.';
  const identity = connection ? `${item.from} → ${item.to}` : item.id;
  return `<form novalidate><div class="dialog-heading"><h2 id="dialog-title">Edit label</h2><p>${e(identity)}</p></div>
    ${field('Label', textarea(item.label ?? '', `id="preview-label-text" aria-label="Label" autofocus placeholder="${e(connection ? 'Optional' : item.id)}" aria-describedby="label-dialog-help"`))}
    <p id="label-dialog-help" class="field-help">${help} Enter inserts a line break. Ctrl+Enter saves.</p>
    <p id="label-dialog-error" class="field-error" role="status"></p>
    <footer class="dialog-actions">${button('cancel-dialog', 'Cancel', { className: 'outline' })}${button('confirm-label', 'Save', { className: 'primary' })}</footer></form>`;
}
