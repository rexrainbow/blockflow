import { h } from './dom.js';
import { icon } from './icons.js';
import { showMenu, closeMenu } from './controls.js';

const fmt = (v) => (typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : v === undefined ? '' : String(v));

/**
 * Diagram-independent style editor.
 * schema: [{ id, title, path (sub-object key or null), fields }] for this kind of item
 * builtIn: the runtime defaults for this kind (fallback placeholder when no layout yet)
 * colors: swatches offered by the color menu (usually colors already in the document)
 * value: authored partial style (may be undefined)
 * effective: resolved style from the layout (may be undefined)
 * set(path, key, value|undefined): commit one property
 */
export function styleEditor({ schema: all, builtIn, colors = [], value = {}, effective, set, reset, fidPrefix, sections }) {
  const schema = all.filter((sec) => !sections || sections.includes(sec.id));
  return schema.map((section) => {
    const own = (section.path ? value?.[section.path] : value) ?? {};
    const eff = (section.path ? effective?.[section.path] : effective) ?? (section.path ? builtIn?.[section.path] : builtIn) ?? {};
    const overrides = section.fields.filter((f) => own[f.key] !== undefined).length;
    return h(
      'details',
      { class: 'style-section', open: section.id === schema[0].id || overrides > 0 ? true : undefined },
      h(
        'summary',
        h('span', { class: 'summary-title' }, section.title),
        overrides ? h('span', { class: 'override-count', title: `${overrides} value(s) set on this item` }, String(overrides)) : null,
        overrides
          ? h(
              'button',
              {
                type: 'button',
                class: 'link-btn small',
                onclick: (e) => {
                  e.preventDefault();
                  reset(section.path, section.fields.map((f) => f.key));
                },
              },
              'Reset',
            )
          : null,
      ),
      h('div', { class: 'style-grid' }, section.fields.map((f) => fieldFor(f, own[f.key], eff[f.key], (v) => set(section.path, f.key, v), colors, `${fidPrefix}-${section.id}-${f.key}`))),
    );
  });
}

/**
 * Filled: the value is set here (click to go back to the inherited/preset value).
 * Hollow: inherited; the field's placeholder shows the value in use.
 * `words` replaces the wording for non-style fields, e.g. layout presets.
 */
export function overrideDot(isSet, reset, label, words = {}) {
  return h('button', {
    type: 'button',
    class: ['ovr', isSet && 'on'],
    title: isSet ? (words.setTitle ?? `Set on this item — click to inherit`) : (words.unsetTitle ?? 'Inherited'),
    'aria-label': isSet ? (words.setLabel ?? `Reset ${label} to inherited value`) : (words.unsetLabel ?? `${label} is inherited`),
    disabled: !isSet,
    onclick: reset,
  });
}

function fieldFor(f, own, eff, commit, colors, fidKey) {
  const isSet = own !== undefined;
  const label = h('div', { class: 'sf-label' }, h('span', f.label), overrideDot(isSet, () => commit(undefined), f.label));
  let control;
  if (f.type === 'color') control = colorControl(own, eff, commit, colors, fidKey, f.label);
  else if (f.type === 'number') {
    control = h('input', {
      class: 'input num',
      type: 'number',
      inputmode: 'decimal',
      min: f.min,
      max: f.max,
      step: f.step,
      value: isSet ? fmt(own) : '',
      placeholder: fmt(eff),
      'data-fid': fidKey,
      'aria-label': f.label,
      onchange: (e) => {
        const raw = e.target.value.trim();
        if (raw === '') return commit(undefined);
        const n = Number(raw);
        if (!Number.isFinite(n)) return;
        commit(n);
      },
    });
  } else if (f.type === 'enum') {
    control = h(
      'select',
      { class: 'input select', 'data-fid': fidKey, 'aria-label': f.label, onchange: (e) => commit(e.target.value === '' ? undefined : e.target.value) },
      h('option', { value: '', selected: !isSet }, `Inherit (${f.options.find((o) => o.key === eff)?.label ?? (fmt(eff) || f.inheritLabel || '—')})`),
      f.options.map((o) => h('option', { value: o.key, selected: isSet && own === o.key }, o.label)),
    );
  } else if (f.type === 'bool') {
    control = h(
      'select',
      { class: 'input select', 'data-fid': fidKey, 'aria-label': f.label, onchange: (e) => commit(e.target.value === '' ? undefined : e.target.value === 'true') },
      h('option', { value: '', selected: !isSet }, `Inherit (${eff ? 'Yes' : 'No'})`),
      h('option', { value: 'true', selected: own === true }, 'Yes'),
      h('option', { value: 'false', selected: own === false }, 'No'),
    );
  }
  return h('div', { class: ['sf', isSet && 'set'] }, label, control);
}

const isTransparent = (c) => typeof c === 'string' && /^#[0-9a-f]{6}00$/i.test(c);
const swatchColor = (c) => (!c ? 'transparent' : isTransparent(c) ? 'transparent' : c.length === 9 ? c.slice(0, 7) : c);

function colorControl(own, eff, commit, colors, fidKey, label) {
  const shown = own ?? eff;
  const sw = h('button', {
    type: 'button',
    class: ['swatch', isTransparent(shown) && 'transparent'],
    style: { '--sw': swatchColor(shown) },
    title: 'Choose color',
    'aria-label': `Choose ${label}`,
    onclick: (e) => {
      const native = h('input', {
        type: 'color',
        class: 'native-color',
        value: /^#[0-9a-f]{6}/i.test(shown ?? '') ? shown.slice(0, 7) : '#000000',
        onchange: (ev) => {
          closeMenu();
          commit(ev.target.value);
        },
      });
      const menu = showMenu(e.currentTarget, [], { label: 'Colors' });
      menu.classList.add('color-menu');
      menu.append(
        h(
          'div',
          { class: 'swatches' },
          colors.map((c) =>
            h('button', {
              type: 'button',
              class: 'swatch big',
              style: { '--sw': c },
              title: c,
              'aria-label': c,
              onclick: () => {
                closeMenu();
                commit(c);
              },
            }),
          ),
          h('button', { type: 'button', class: 'swatch big transparent', title: 'Transparent', 'aria-label': 'Transparent', onclick: () => (closeMenu(), commit('transparent')) }),
        ),
        h('label', { class: 'color-custom' }, native, h('span', 'Custom…')),
      );
    },
  });
  const text = h('input', {
    class: 'input mono color-text',
    value: own ?? '',
    placeholder: eff ?? '',
    spellcheck: 'false',
    'data-fid': fidKey,
    'aria-label': label + ' (hex or transparent)',
    onchange: (e) => {
      const v = e.target.value.trim();
      if (!v) return commit(undefined);
      if (v !== 'transparent' && !/^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)) {
        e.target.setAttribute('aria-invalid', 'true');
        e.target.title = 'Use #RGB, #RRGGBB, #RRGGBBAA or transparent';
        return;
      }
      commit(v);
    },
  });
  return h('div', { class: 'color-control' }, sw, text);
}

export function quickStyles(presets, apply, current) {
  return h(
    'div',
    { class: 'chips', role: 'list', 'aria-label': 'Quick styles' },
    presets.map((p) => {
      const on = current && Object.entries(p.style).every(([k, v]) => String(current[k]).toLowerCase() === String(v).toLowerCase());
      return h(
        'button',
        { type: 'button', role: 'listitem', class: ['chip', on && 'on'], title: 'Apply ' + p.name + ' style', onclick: () => apply(p.style) },
        h('span', {
          class: 'chip-sample',
          style: {
            '--c': p.style.strokeColor ?? p.style.borderColor ?? '#000',
            '--f': p.style.fillColor ?? 'transparent',
            '--ls': p.style.lineStyle ?? p.style.borderStyle ?? 'solid',
          },
        }),
        p.name,
      );
    }),
  );
}

export { icon };
