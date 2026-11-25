// Tiny DOM helpers. Text is always assigned as text, never parsed as HTML.
const SVG_NS = 'http://www.w3.org/2000/svg';
/** The value each form control was built with, i.e. the document value it shows. */
const builtValue = new WeakMap();

function apply(el, props) {
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.setAttribute('class', Array.isArray(value) ? value.filter(Boolean).join(' ') : value);
    else if (key === 'style' && typeof value === 'object')
      for (const [prop, v] of Object.entries(value)) {
        if (prop.startsWith('--')) el.style.setProperty(prop, v);
        else el.style[prop] = v;
      }
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else if (key === 'value' && 'value' in el) {
      el.value = value;
      builtValue.set(el, el.value);
    }
    else if (key === 'checked' || key === 'disabled' || key === 'hidden' || key === 'selected') el[key] = Boolean(value);
    else el.setAttribute(key, value === true ? '' : String(value));
  }
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export function h(tag, props, ...children) {
  if (props instanceof Node || typeof props !== 'object' || Array.isArray(props)) {
    children.unshift(props);
    props = {};
  }
  const el = document.createElement(tag);
  apply(el, props);
  append(el, children);
  return el;
}

export function s(tag, props, ...children) {
  const el = document.createElementNS(SVG_NS, tag);
  apply(el, props);
  append(el, children);
  return el;
}

/** Text-like controls whose typed, uncommitted text is a draft worth keeping. */
const DRAFT_TYPES = new Set(['text', 'search', 'number', 'url', 'email', 'tel', '']);
const holdsDraft = (el) =>
  el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && DRAFT_TYPES.has(el.getAttribute('type') ?? ''));

/**
 * Replace children while keeping keyboard focus and caret on the same logical field.
 * A re-render (a layout result, another field's commit) rebuilds controls from the
 * document. Removing a focused, edited control makes the browser fire `change` right
 * away, which would commit the draft in the middle of this render and then show the old
 * value again. So the old control is reset silently first, and its draft is handled here:
 * - same field rebuilt from an unchanged document value: it keeps the draft, caret and
 *   any inline error (nothing is committed);
 * - same field, document value changed elsewhere (Undo, another editor): the new value wins;
 * - field gone: the draft commits through the old control after the new content is in.
 */
export function replaceKeepingFocus(container, ...children) {
  const nodes = children.flat(Infinity).filter(Boolean);
  const active = document.activeElement;
  const fid = active && container.contains(active) ? active.dataset.fid : null;
  const caret = fid && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;
  const selector = fid && `[data-fid="${CSS.escape(fid)}"]`;
  const next = fid ? nodes.map((n) => (n instanceof Element ? (n.matches(selector) ? n : n.querySelector(selector)) : null)).find(Boolean) : null;
  const base = fid ? (builtValue.get(active) ?? '') : '';
  const draft =
    fid && holdsDraft(active) && active.value !== base
      ? { value: active.value, invalid: active.getAttribute('aria-invalid') === 'true', title: active.title, error: active.parentElement?.querySelector(':scope > .field-error')?.textContent }
      : null;
  if (draft) active.value = base; // removal must not commit mid-render
  const scroll = container.scrollTop;
  container.replaceChildren(...nodes);
  container.scrollTop = scroll;
  if (!next) {
    if (draft) {
      active.value = draft.value;
      active.dispatchEvent(new Event('change'));
    }
    return;
  }
  if (draft && holdsDraft(next) && (builtValue.get(next) ?? '') === base) {
    next.value = draft.value;
    builtValue.set(next, base);
    if (draft.invalid) {
      next.setAttribute('aria-invalid', 'true');
      next.title = draft.title;
      next.closest('.field')?.classList.add('has-error');
      if (draft.error) next.after(h('div', { class: 'field-error', role: 'alert' }, draft.error));
    }
    // Let the control resync to its value (textarea rows, combobox list).
    next.dispatchEvent(new Event('input'));
  }
  next.focus({ preventScroll: true });
  if (caret && typeof next.setSelectionRange === 'function') {
    try {
      next.setSelectionRange(...caret);
    } catch {
      /* some input types do not support selection */
    }
  }
}

export const singleLine = (value) => String(value ?? '').replace(/\s*\r?\n\s*/g, ' / ');

export function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export function storage(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function store(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const modKey = isMac ? '⌘' : 'Ctrl';

/** replaceChildren that skips null/false and flattens arrays. */
export function fill(el, ...children) {
  el.replaceChildren(...children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false));
}
