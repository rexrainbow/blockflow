import { FlowchartCanvas } from '../../flowchart/components/canvas.js';
import { addState, addTransition, reconnectTransition } from '../../../editor/statechart/commands.js';
import { findState, findTransition, stateName } from '../state/actions.js';

/**
 * Statechart overlay: the Flowchart graph overlay on the Statechart Worker's layout
 * (states and transitions; no groups or notes). Handles add transitions (drop on the
 * same state for a self transition) or a new connected state on empty space; a selected
 * transition's ends reconnect it. Every drop is checked with the runtime command first.
 */
export class StatechartCanvas extends FlowchartCanvas {
  noun = 'state';
  ops = {
    connect: (doc, from, to) => addTransition(doc, from, to),
    reconnect: (doc, key, end, state) => reconnectTransition(doc, key, end, state),
    addConnected: (doc, from) => {
      const next = addState(doc, {});
      return addTransition(next, from, next.states.at(-1).id);
    },
  };

  /** The layout names nodes `states` and edges `transitions`; the overlay reads graph names. */
  setLayout(result) {
    const L = result.layout;
    super.setLayout({ ...result, layout: { ...L, nodes: L.states, edges: L.transitions, groups: [] } });
  }

  /** States have no groups to move into: dragging a state pans, handles still connect. */
  dragKind(hit) {
    const kind = super.dragKind(hit);
    return kind === 'move' ? null : kind;
  }

  nameOf(doc, id) {
    return stateName(findState(doc, id) ?? { id });
  }

  edgeOf(doc, key) {
    return findTransition(doc, key);
  }
}
