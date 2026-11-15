// Tiny DOM helpers. Text is always assigned as text, never parsed as HTML.
const SVG_NS = 'http://www.w3.org/2000/svg';

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
    else if (key === 'value' && 'value' in el) el.value = value;
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

/** Replace children while keeping keyboard focus and caret on the same logical field. */
export function replaceKeepingFocus(container, ...children) {
  const active = document.activeElement;
  const fid = active && container.contains(active) ? active.dataset.fid : null;
  const caret = fid && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;
  const scroll = container.scrollTop;
  container.replaceChildren(...children.flat(Infinity).filter(Boolean));
  container.scrollTop = scroll;
  if (fid) {
    const next = container.querySelector(`[data-fid="${CSS.escape(fid)}"]`);
    if (next) {
      next.focus({ preventScroll: true });
      if (caret && typeof next.setSelectionRange === 'function') {
        try {
          next.setSelectionRange(...caret);
        } catch {
          /* some input types do not support selection */
        }
      }
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
