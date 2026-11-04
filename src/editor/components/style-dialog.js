import { parseStyle } from '../../lib/styles.js';
import { button, escape as e, field, input, select } from './ui.js';

const textFields = [
  ['Text color', 'color', 'color'],
  ['Background color', 'backgroundColor', 'color'],
  ['Font size', 'fontSize', 'positive'],
  ['Padding', 'padding', 'nonnegative'],
  ['Text opacity', 'opacity', 'opacity'],
  ['Background opacity', 'backgroundOpacity', 'opacity'],
];
const blockFields = [
  ['Border color', 'borderColor', 'color'],
  ['Border width', 'borderWidth', 'positive'],
  ['Border pattern', 'borderStyle', 'pattern'],
  ['Block fill', 'fillColor', 'color'],
  ['Border opacity', 'borderOpacity', 'opacity'],
  ['Fill opacity', 'fillOpacity', 'opacity'],
];
const connectionFields = [
  ['Line color', 'strokeColor', 'color'],
  ['Line width', 'strokeWidth', 'positive'],
  ['Line pattern', 'lineStyle', 'pattern'],
  ['Opacity', 'opacity', 'opacity'],
];

function fields(definitions, style, group) {
  return `<div class="style-grid">${definitions
    .map(([label, property, type]) => {
      const value = style?.[property] ?? '';
      const attrs = `data-style-property="${property}" data-style-group="${group}" aria-label="${label}"`;
      const numeric = ['positive', 'nonnegative', 'opacity'].includes(type);
      const control =
        type === 'pattern'
          ? select(
              [
                { value: '', label: 'Inherit default' },
                ...['solid', 'dashed', 'dotted'].map((value, i) => ({
                  value,
                  label: ['Solid', 'Dashed', 'Dotted'][i],
                })),
              ],
              value,
              attrs,
            )
          : input(
              value,
              `${attrs} placeholder="Inherit default" ${numeric ? `min="${type === 'positive' ? '0.1' : '0'}" step="any" ${type === 'opacity' ? 'max="1"' : ''}` : 'spellcheck="false"'}`,
              numeric ? 'number' : 'text',
            );
      return field(label, control, type === 'color' ? 'Hex color or transparent' : '');
    })
    .join('')}</div>`;
}

export function renderStyleDialog(session) {
  const { kind, style = {}, label, direction, section = '' } = session;
  const groups =
    kind === 'module'
      ? [
          ['', 'Block', blockFields],
          ['label', 'Label', textFields],
          ['portLabel', 'All ports', textFields],
          ['inputPortLabel', 'Input labels', textFields],
          ['outputPortLabel', 'Output labels', textFields],
        ]
      : kind === 'group'
        ? [
            [
              '',
              'Group',
              blockFields.map(([name, key, type]) => [key === 'fillColor' ? 'Group fill' : name, key, type]),
            ],
            ['label', 'Label', textFields],
            ['portLabel', 'All ports', textFields],
            ['inputPortLabel', 'Input labels', textFields],
            ['outputPortLabel', 'Output labels', textFields],
          ]
        : kind === 'connection'
          ? [
              ['', 'Line', connectionFields],
              ['label', 'Label', textFields],
            ]
          : [['', 'Text', textFields]];
  const title =
    kind === 'group'
      ? 'Group style'
      : kind === 'module'
        ? 'Block style'
        : kind === 'port'
          ? `${direction === 'input' ? 'Input' : 'Output'} port text style`
          : 'Connection style';
  const active = groups.some(([key]) => key === section) ? section : '';
  return `<form novalidate class="style-form">
    <header class="dialog-heading"><span class="dialog-eyebrow">STYLE</span><h2 id="dialog-title">${title}</h2><p class="style-target">${e(label)}</p></header>
    <p id="style-dialog-help" class="style-help">Blank fields inherit defaults. Changes apply only when you select OK.${kind === 'module' ? ' Individual port styles override the shared port defaults.' : kind === 'port' ? ' These settings affect only this port label.' : ''}</p>
    ${groups.length > 1 ? `<div class="style-tabs" role="tablist" aria-label="Style section">${groups.map(([key, name]) => `<button type="button" role="tab" id="style-tab-${key || 'block'}" aria-selected="${key === active}" aria-controls="style-panel-${key || 'block'}" tabindex="${key === active ? '0' : '-1'}" data-action="style-tab" data-style-section="${key}">${name}</button>`).join('')}</div>` : ''}
    <div class="style-dialog-body">${groups.map(([key, name, definitions]) => `<section id="style-panel-${key || 'block'}" class="style-tab-panel" ${groups.length > 1 ? `role="tabpanel" aria-labelledby="style-tab-${key || 'block'}"` : `aria-label="${name} style"`} ${key !== active ? 'hidden' : ''}>${fields(definitions, key ? style[key] : style, key)}</section>`).join('')}</div>
    <p id="style-dialog-error" class="field-error" role="alert"></p>
    <footer class="dialog-actions">${button('cancel-dialog', 'Cancel', { className: 'outline' })}${button('confirm-style', 'OK', { className: 'primary' })}</footer>
  </form>`;
}

export function selectStyleTab(dialog, section, focus = true) {
  const tabs = [...dialog.querySelectorAll('[role="tab"]')];
  const selected = tabs.find((tab) => tab.dataset.styleSection === section);
  if (!selected) return;
  for (const tab of tabs) {
    const active = tab === selected;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    dialog.querySelector(`#${tab.getAttribute('aria-controls')}`).hidden = !active;
  }
  if (focus) selected.focus();
}

export function readStyleDialog(dialog, session) {
  const style = structuredClone(session.style ?? {});
  for (const element of dialog.querySelectorAll('[data-style-property]')) {
    const group = element.dataset.styleGroup;
    const property = element.dataset.styleProperty;
    const value = element.value.trim();
    const target = group ? (style[group] ??= {}) : style;
    if (element.validity.badInput) {
      const error = new Error('Enter a valid number or leave the field blank to inherit.');
      error.path = `style${group ? `.${group}` : ''}.${property}`;
      throw error;
    }
    if (!value) delete target[property];
    else target[property] = element.type === 'number' ? Number(value) : value;
  }
  for (const key of ['label', 'portLabel', 'inputPortLabel', 'outputPortLabel']) {
    if (style[key] && !Object.keys(style[key]).length) delete style[key];
  }
  parseStyle(style, session.kind === 'port' ? 'text' : session.kind, 'style', (message, path) => {
    const error = new Error(
      message.includes('hex color')
        ? 'Use a hex color (#RGB, #RRGGBB, with optional alpha) or transparent.'
        : message.includes('opacity')
          ? 'Opacity must be between 0 and 1.'
          : message.includes('non-negative')
            ? 'Enter a number greater than or equal to zero.'
            : message.includes('positive')
              ? 'Enter a number greater than zero.'
              : message,
    );
    error.path = path;
    throw error;
  });
  return style;
}

export function styleErrorField(dialog, path) {
  const parts = path?.split('.') ?? [];
  const property = parts.at(-1);
  const group = parts.length === 3 ? parts[1] : '';
  const element = [...dialog.querySelectorAll('[data-style-property]')].find(
    (el) => el.dataset.styleGroup === group && el.dataset.styleProperty === property,
  );
  if (element) selectStyleTab(dialog, group, false);
  return element;
}
