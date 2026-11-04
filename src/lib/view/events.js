export const VIEW_EVENTS = Object.freeze([
  'blockclick',
  'groupclick',
  'portclick',
  'connectionclick',
  'backgroundclick',
  'selectionchange',
  'viewportchange',
  'statechange',
  'layoutchange',
]);

// Event listeners belong to a view, never to the diagram JSON.
export class ViewEvents {
  constructor(reportError) {
    this.listeners = new Map();
    this.originals = new WeakMap();
    this.reportError = reportError;
  }
  check(name) {
    if (!VIEW_EVENTS.includes(name)) throw new RangeError('Unknown view event: ' + name);
  }
  on(name, handler) {
    this.check(name);
    if (typeof handler !== 'function') throw new TypeError('Event handler must be a function');
    const listeners = this.listeners.get(name) ?? new Set();
    listeners.add(handler);
    this.listeners.set(name, listeners);
    return () => this.off(name, handler);
  }
  off(name, handler) {
    this.check(name);
    if (typeof handler !== 'function') return false;
    const listeners = this.listeners.get(name);
    let removed = false;
    for (const listener of [...(listeners ?? [])]) {
      if (listener === handler || this.originals.get(listener) === handler) {
        listeners.delete(listener);
        removed = true;
      }
    }
    return removed;
  }
  once(name, handler) {
    if (typeof handler !== 'function') throw new TypeError('Event handler must be a function');
    const wrapper = (event) => {
      unsubscribe();
      handler(event);
    };
    this.originals.set(wrapper, handler);
    const unsubscribe = this.on(name, wrapper);
    return unsubscribe;
  }
  emit(name, payload) {
    for (const handler of [...(this.listeners.get(name) ?? [])]) {
      if (!this.listeners.get(name)?.has(handler)) continue;
      try {
        handler(payload);
      } catch (error) {
        this.reportError(error);
      }
    }
  }
  clear() {
    this.listeners.clear();
  }
}
