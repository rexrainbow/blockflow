import { button, field, input, textarea, select, escape as e } from './ui.js';

export function renderTerminalDialog(item, editing = false) {
  return `<form novalidate><div class="dialog-heading"><h2 id="dialog-title">${editing ? 'Edit' : 'Add'} terminal</h2><p>External inputs send into the diagram; external outputs receive from it. Terminals have no block frame.</p></div>
    ${field('Key (ID)', input(item.id, 'id="terminal-id" aria-label="Terminal key" autofocus spellcheck="false"'))}
    ${field(
      'Direction',
      select(
        [
          { value: 'input', label: 'External input' },
          { value: 'output', label: 'External output' },
        ],
        item.direction,
        'id="terminal-direction" aria-label="Terminal direction"',
      ),
    )}
    ${field('Label', textarea(item.label ?? '', `id="terminal-label" aria-label="Terminal label" placeholder="${e(item.id)}"`))}
    ${field('Bit width', input(item.width ?? '', 'id="terminal-width" aria-label="Terminal bit width" placeholder="Unspecified" min="1" step="1"', 'number'))}
    <p class="field-help">Leave Label blank to display the key. Changing a referenced direction or bit width must keep every connection valid.</p>
    <p id="terminal-error" class="field-error" role="status"></p>
    <footer class="dialog-actions">${button('cancel-terminal', 'Cancel', { className: 'outline' })}${button('confirm-terminal', 'Save', { className: 'primary' })}</footer></form>`;
}
