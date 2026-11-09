import { parseStyle } from '../../lib/styles.js';
import { APPEARANCES, parseAppearance } from '../../lib/appearances.js';
import { button, escape as e, field, input, select } from './ui.js';

const textFields = [
  ['Hidden', 'hidden', 'visibility'],
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
  ['End arrow', 'endArrow', 'arrow'],
];

function fields(definitions, style, group) {
  return `<div class="style-grid">${definitions
    .map(([label, property, type]) => {
      const value = style?.[property] ?? '';
      const attrs = `data-style-property="${property}" data-style-group="${group}" aria-label="${label}"`;
      const numeric = ['positive', 'nonnegative', 'opacity'].includes(type);
      const control = ['visibility', 'arrow'].includes(type)
        ? select(
            [
              { value: '', label: 'Inherit default' },
              ...(type === 'visibility'
                ? [
                    { value: 'true', label: 'Yes' },
                    { value: 'false', label: 'No' },
                  ]
                : [
                    { value: 'none', label: 'None' },
                    { value: 'triangle', label: 'Triangle' },
                  ]),
            ],
            value,
            attrs,
          )
        : type === 'pattern'
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

function appearanceFields(appearance, moduleType) {
  const type = appearance?.type ?? (moduleType === 'concat' ? 'bar' : 'rectangle');
  return `<div class="style-grid">${field(
    'Appearance',
    select(
      Object.keys(APPEARANCES).map((value) => ({ value, label: value[0].toUpperCase() + value.slice(1) })),
      type,
      'data-field="appearance" data-appearance-property="type" aria-label="Appearance"',
    ),
  )}
    <div data-appearance-panel="stacked" ${type !== 'stacked' ? 'hidden' : ''}>${field('Stack layers', input(appearance?.layers ?? '', 'data-appearance-property="layers" aria-label="Stack layers" min="1" max="3" step="1" placeholder="Default: 2"', 'number'), 'Visual backing plates only; no members or expansion.')}</div>
    <div data-appearance-panel="trapezoid" ${type !== 'trapezoid' ? 'hidden' : ''}>${field('Right height ratio', input(appearance?.rightHeightRatio ?? '', 'data-appearance-property="rightHeightRatio" aria-label="Right height ratio" min="0.2" max="1" step="0.1" placeholder="Default: 0.6"', 'number'), 'Right-side height relative to the left (0.2–1).')}</div></div>`;
}

export function updateAppearanceFields(dialog) {
  const type = dialog.querySelector('[data-appearance-property="type"]')?.value;
  for (const panel of dialog.querySelectorAll('[data-appearance-panel]'))
    panel.hidden = panel.dataset.appearancePanel !== type;
}

export function readAppearanceDialog(dialog, session) {
  if (session.kind !== 'module') return undefined;
  const type = dialog.querySelector('[data-appearance-property="type"]').value;
  if (type === 'rectangle' || type === 'bar') {
    const defaultType = session.moduleType === 'concat' ? 'bar' : 'rectangle';
    return session.appearance || type !== defaultType ? { type } : undefined;
  }
  const property = type === 'stacked' ? 'layers' : 'rightHeightRatio';
  const field = dialog.querySelector(`[data-appearance-property="${property}"]`);
  const value = { type, ...(field.value !== '' ? { [property]: Number(field.value) } : {}) };
  const fail = (message, path) => {
    const error = new Error(message);
    error.path = path;
    throw error;
  };
  if (field.validity.badInput)
    fail('Enter a valid appearance parameter or leave it blank for the default.', `appearance.${property}`);
  parseAppearance(value, 'appearance', fail);
  return value;
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
          : kind === 'terminal'
            ? 'Terminal text style'
            : 'Connection style';
  const active = groups.some(([key]) => key === section) ? section : '';
  return `<form novalidate class="style-form">
    <header class="dialog-heading"><span class="dialog-eyebrow">STYLE</span><h2 id="dialog-title">${title}</h2><p class="style-target">${e(label)}</p></header>
    <p id="style-dialog-help" class="style-help">Blank fields inherit defaults. Changes apply only when you select OK.${kind === 'module' ? ' Individual port styles override the shared port defaults.' : kind === 'port' ? ' These settings affect only this port label.' : ''}</p>
    ${groups.length > 1 ? `<div class="style-tabs" role="tablist" aria-label="Style section">${groups.map(([key, name]) => `<button type="button" role="tab" id="style-tab-${key || 'block'}" aria-selected="${key === active}" aria-controls="style-panel-${key || 'block'}" tabindex="${key === active ? '0' : '-1'}" data-action="style-tab" data-style-section="${key}">${name}</button>`).join('')}</div>` : ''}
    <div class="style-dialog-body">${groups.map(([key, name, definitions]) => `<section id="style-panel-${key || 'block'}" class="style-tab-panel" ${groups.length > 1 ? `role="tabpanel" aria-labelledby="style-tab-${key || 'block'}"` : `aria-label="${name} style"`} ${key !== active ? 'hidden' : ''}>${kind === 'module' && key === '' ? appearanceFields(session.appearance, session.moduleType) : ''}${fields(definitions, key ? style[key] : style, key)}</section>`).join('')}</div>
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
    else
      target[property] =
        property === 'hidden' ? value === 'true' : element.type === 'number' ? Number(value) : value;
  }
  for (const key of ['label', 'portLabel', 'inputPortLabel', 'outputPortLabel']) {
    if (style[key] && !Object.keys(style[key]).length) delete style[key];
  }
  parseStyle(
    style,
    ['port', 'terminal'].includes(session.kind) ? 'text' : session.kind,
    'style',
    (message, path) => {
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
    },
  );
  return style;
}

export function styleErrorField(dialog, path) {
  if (path?.startsWith('appearance.')) {
    selectStyleTab(dialog, '', false);
    return dialog.querySelector(`[data-appearance-property="${path.split('.').at(-1)}"]`);
  }
  const parts = path?.split('.') ?? [];
  const property = parts.at(-1);
  const group = parts.length === 3 ? parts[1] : '';
  const element = [...dialog.querySelectorAll('[data-style-property]')].find(
    (el) => el.dataset.styleGroup === group && el.dataset.styleProperty === property,
  );
  if (element) selectStyleTab(dialog, group, false);
  return element;
}
