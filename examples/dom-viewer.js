import '../src/editor/styles/tokens.css';
import '../src/editor/styles/editor.css';
import './dom-viewer.css';
import input from './nested-groups.json';
import { button } from '../src/editor/components/ui.js';
import { createDiagramModel, layoutDiagram, renderSvg, mountDiagram, exportDom } from '../src/lib/browser.js';

const host = document.querySelector('#viewer');
const status = document.querySelector('#demo-status');
const controls = document.querySelector('#demo-controls');
controls.innerHTML = [
  button('fit', 'Fit to view', { className: 'outline' }),
  button('zoom-in', 'Zoom in', { className: 'outline', glyph: 'plus' }),
  button('zoom-out', 'Zoom out', { className: 'outline' }),
  button('running', 'Mark running', { className: 'outline' }),
  button('complete', 'Mark complete', { className: 'outline' }),
  button('value', 'Show port value', { className: 'outline' }),
  button('clear', 'Clear state', { className: 'outline' }),
].join('');
controls.querySelectorAll('button').forEach((button) => (button.disabled = true));

async function start() {
  const layout = await layoutDiagram(createDiagramModel(input));
  const view = mountDiagram(host, layout, { ariaLabel: 'Interactive hardware diagram' });
  const recent = [];
  const stateTarget = () =>
    view.selection?.type === 'connection'
      ? view.selection
      : view.selection?.type === 'block'
        ? view.selection
        : view.selection?.type === 'port'
          ? { type: 'block', id: view.selection.blockId }
          : null;
  const updateControls = () => {
    for (const action of ['running', 'complete'])
      controls.querySelector(`[data-action="${action}"]`).disabled = !stateTarget();
  };
  for (const name of [
    'blockclick',
    'groupclick',
    'portclick',
    'connectionclick',
    'backgroundclick',
    'selectionchange',
    'statechange',
    'layoutchange',
    'viewportchange',
  ])
    view.on(name, (event) => {
      const summary = {
        event: event.type,
        ...(event.id ? { id: event.id } : {}),
        ...(event.selection ? { selection: event.selection.id } : {}),
        ...(event.state ? { state: event.state } : {}),
      };
      recent.unshift(JSON.stringify(summary, null, 2));
      recent.length = Math.min(recent.length, 12);
      document.querySelector('#event-log').textContent = recent.join('\n\n');
      if (name === 'selectionchange') {
        status.textContent = event.selection
          ? `Selected ${event.selection.type}: ${event.selection.id}`
          : 'Selection cleared';
        updateControls();
      }
    });
  controls.querySelectorAll('button').forEach((button) => (button.disabled = false));
  controls.addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    try {
      if (action === 'fit') view.fit();
      if (action === 'zoom-in' || action === 'zoom-out') view.zoom(action === 'zoom-in' ? 1.25 : 0.8);
      if (action === 'clear') view.clearState();
      if (action === 'value')
        view.setPortValue(view.selection?.type === 'port' ? view.selection.id : 'A.b_out', '0x2A');
      if (action === 'running' || action === 'complete') {
        const target = stateTarget();
        if (target)
          view[target.type === 'block' ? 'setBlockState' : 'setConnectionState'](target.id, {
            status: action === 'running' ? 'running' : 'success',
          });
      }
    } catch (error) {
      status.textContent = error.message;
    }
  });
  host.setAttribute('aria-busy', 'false');
  view.select({ type: 'block', id: 'A' });
  // An explicit example/debug handle, never installed by the library itself.
  window.portsketchDemo = {
    view,
    input,
    layout,
    createDiagramModel,
    layoutDiagram,
    renderSvg,
    mountDiagram,
    exportDom,
  };
}
start().catch((error) => {
  host.setAttribute('aria-busy', 'false');
  status.textContent = 'Cannot display diagram: ' + error.message;
});
