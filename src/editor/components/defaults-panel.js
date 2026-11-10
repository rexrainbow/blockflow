import {
  DEFAULT_CATEGORIES,
  newDefaultsDraft,
  defaultsDirty,
  defaultsStyle,
  defaultFieldHint,
} from '../state/defaults.js';
import { styleSections, renderStyleFields, selectStyleTab, updateStyleHints } from './style-dialog.js';
import { button, field, select, escape as e, setFieldError, clearFieldError } from './ui.js';
import { validateDocument } from '../state/commands.js';

/** Document-scoped transactional defaults, using the canonical Style fields and draft storage. */
export class DefaultsPanel {
  constructor(editor, stored) {
    this.editor = editor;
    this.host = editor.root.querySelector('#defaults-settings');
    this.draft = newDefaultsDraft(editor.document, stored);
    this.host.addEventListener('input', (event) => this.input(event.target));
    this.host.addEventListener('change', (event) => {
      if (event.target.matches('[data-defaults-category]')) {
        this.draft.category = event.target.value;
        this.draft.section = '';
        this.render();
        this.host.querySelector('[data-defaults-category]').focus({ preventScroll: true });
        this.editor.persist();
      } else this.input(event.target);
    });
    this.host.addEventListener('compositionend', (event) => queueMicrotask(() => this.input(event.target)));
    this.host.addEventListener('keydown', (event) => {
      if (event.isComposing || this.editor.composing || !event.target.matches('[role="tab"]')) return;
      const tabs = [...this.host.querySelectorAll('[role="tab"]')],
        index = tabs.indexOf(event.target);
      const next =
        event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? tabs.length - 1
            : event.key === 'ArrowRight'
              ? (index + 1) % tabs.length
              : event.key === 'ArrowLeft'
                ? (index + tabs.length - 1) % tabs.length
                : null;
      if (next === null) return;
      event.preventDefault();
      event.stopPropagation();
      this.section(tabs[next].dataset.styleSection);
    });
  }
  get dirty() {
    return defaultsDirty(this.draft);
  }
  serialize() {
    return this.draft;
  }
  sync() {
    if (JSON.stringify(this.draft.base) !== JSON.stringify(this.editor.document.diagram.style ?? {})) {
      const { category, section } = this.draft;
      this.draft = { ...newDefaultsDraft(this.editor.document), category, section };
    }
  }
  reset() {
    const { category, section } = this.draft;
    this.draft = { ...newDefaultsDraft(this.editor.document), category, section };
    this.error = '';
    this.render();
    this.editor.persist();
    this.editor.updateControls();
  }
  render() {
    this.sync();
    const { category, section } = this.draft,
      groups = styleSections(category),
      style = defaultsStyle(this.draft, false)[category] ?? {};
    this.host.innerHTML = `<section class="panel defaults-panel" aria-labelledby="defaults-heading"><header class="panel-header"><h2 id="defaults-heading">Defaults</h2><span id="defaults-state" class="field-help"></span></header><div class="panel-scroll defaults-body" data-scroll="defaults">
      ${field(
        'Style category',
        select(
          DEFAULT_CATEGORIES.map(([value, label]) => ({ value, label })),
          category,
          'data-defaults-category aria-label="Default style category"',
        ),
      )}
      <p class="field-help">Defaults for this diagram. Blank fields inherit the displayed value. Individual object styles can override these settings. Apply updates the preview.</p>
      <div class="style-tabs" role="tablist" aria-label="Default style section">${groups.map(([key, name]) => button('defaults-section', name, { attrs: `role="tab" id="defaults-tab-${key || 'base'}" aria-selected="${key === section}" aria-controls="defaults-panel-${key || 'base'}" tabindex="${key === section ? '0' : '-1'}" data-style-section="${key}"` })).join('')}</div>
      ${groups.map(([key]) => `<section data-defaults-kind="${category}" id="defaults-panel-${key || 'base'}" role="tabpanel" aria-labelledby="defaults-tab-${key || 'base'}" ${key !== section ? 'hidden' : ''}>${renderStyleFields(groups.find(([group]) => group === key)[2], key ? style[key] : style, key, (group, property) => defaultFieldHint(this.draft, group, property))}</section>`).join('')}
      <p id="defaults-error" class="field-error" role="alert">${e(this.error ?? '')}</p></div>
      <footer class="panel-footer defaults-actions">${button('defaults-discard', 'Discard', { className: 'outline' })}${button('defaults-apply', 'Apply', { className: 'primary' })}</footer></section>`;
    this.status();
  }
  status() {
    const dirty = this.dirty;
    this.host.querySelector('#defaults-state').textContent = dirty
      ? 'Unapplied changes'
      : 'No pending changes';
    this.host.querySelector('[data-action="defaults-apply"]').disabled = !dirty;
    this.host.querySelector('[data-action="defaults-discard"]').disabled = !dirty;
  }
  section(section, focus = true) {
    this.draft.section = section;
    selectStyleTab(this.host, section, focus);
    this.editor.persist();
  }
  input(element) {
    if (this.editor.composing || !element.matches('[data-style-property]') || !this.host.contains(element))
      return;
    const kind = element.closest('[data-defaults-kind]')?.dataset.defaultsKind;
    if (!kind) return;
    const key = [kind, element.dataset.styleGroup, element.dataset.styleProperty].join('/');
    this.draft.inputs[key] = { value: element.value, badInput: element.validity.badInput };
    clearFieldError(element);
    this.error = '';
    this.host.querySelector('#defaults-error').textContent = '';
    updateStyleHints(this.host, {}, (section, property) => defaultFieldHint(this.draft, section, property));
    this.status();
    this.editor.persist();
    this.editor.updateControls();
  }
  action(action, trigger) {
    if (action === 'defaults-section') return this.section(trigger.dataset.styleSection);
    if (this.editor.composing) return;
    if (action === 'defaults-discard') {
      this.reset();
      this.host.querySelector('[data-defaults-category]').focus({ preventScroll: true });
      this.editor.announce('Unapplied default styles discarded.');
      return;
    }
    if (action !== 'defaults-apply' || !this.dirty) return;
    try {
      const style = defaultsStyle(this.draft);
      this.editor.commit((doc) => {
        if (Object.keys(style).length) doc.diagram.style = style;
        else delete doc.diagram.style;
        validateDocument(doc);
      }, 'Default styles applied.');
      this.reset();
      this.host.querySelector('[data-defaults-category]').focus({ preventScroll: true });
    } catch (error) {
      this.error = error.message;
      if (error.defaultsKey) {
        const [category, section, property] = error.defaultsKey.split('/');
        this.draft.category = category;
        this.draft.section = section;
        this.render();
        const field = [...this.host.querySelectorAll('[data-style-property]')].find(
          (el) => el.dataset.styleGroup === section && el.dataset.styleProperty === property,
        );
        if (field) setFieldError(field, error.message);
      } else this.host.querySelector('#defaults-error').textContent = error.message;
      this.editor.persist();
    }
  }
}
