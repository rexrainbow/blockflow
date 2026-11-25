import { createDiagramModel, layoutDiagram, renderSvg } from '../../lib/blockchart/index.js';
import { endpointLabel } from '../../lib/blockchart/endpoints.js';
import { connectionKey } from './commands.js';
import { geometryKey, repaintLayout } from './paint-layout.js';

/** Run one Blockchart job without installing listeners or accessing a DOM. */
export function runLayoutJob(data) {
  return runJob(data, layoutDiagram);
}

/** One private baseline per Worker lifetime. Direct runLayoutJob calls stay independent. */
export function createLayoutJobRunner(computeLayout = layoutDiagram) {
  const session = { baseline: null, generation: 0 };
  return (data) => runJob(data, computeLayout, session);
}

async function runJob(data, computeLayout, session) {
  if (!data?.document || !Number.isInteger(data.revision)) return null;
  const rootGroupId = data.rootGroupId ?? null;
  const generation = session && ++session.generation;
  try {
    const model = createDiagramModel(data.document);
    const key = session && geometryKey(data.document);
    const baseline = session?.baseline;
    // Capture hit targets with the validated revision before asynchronous placement.
    const hitTargets = (data.document.connections ?? []).map((connection) => ({
      editorKey: connectionKey(connection),
      editorLabel: `${endpointLabel(connection.from)} to ${endpointLabel(connection.to)}`,
    }));
    const rootSlot = rootGroupId === null ? null : model.groups.findIndex((g) => g.id === rootGroupId);
    const reuse =
      data.paintOnly === true &&
      baseline &&
      rootSlot !== -1 &&
      baseline.rootSlot === rootSlot &&
      baseline.key === key;
    const painted = reuse ? repaintLayout(baseline.layout, model, baseline.model, rootGroupId) : null;
    if (session && !painted) session.baseline = null;
    const layout = painted ?? (await computeLayout(model, { rootGroupId }));
    for (const edge of layout.connections) {
      const index = edge.connectionIndex ?? Number(edge.id.slice('connection_'.length));
      Object.assign(edge, hitTargets[index]);
    }
    const svg = renderSvg(layout);
    if (!painted && session && session.generation === generation)
      session.baseline = { key, rootSlot, model, layout: structuredClone(layout) };
    return { revision: data.revision, layout, svg };
  } catch (error) {
    if (session && session.generation === generation) session.baseline = null;
    return { revision: data.revision, error: error.message, path: error.path ?? error.cause?.path };
  }
}
