import { createDiagramModel, layoutDiagram, renderSvg } from '../../lib/blockchart/index.js';
import { endpointLabel } from '../../lib/blockchart/endpoints.js';
import { connectionKey } from './commands.js';

/** Run one Blockchart job without installing listeners or accessing a DOM. */
export async function runLayoutJob(data) {
  if (!data?.document || !Number.isInteger(data.revision)) return null;
  try {
    const layout = await layoutDiagram(createDiagramModel(data.document), { rootGroupId: data.rootGroupId });
    for (const edge of layout.connections) {
      const connection =
        data.document.connections[edge.connectionIndex ?? Number(edge.id.slice('connection_'.length))];
      edge.editorKey = connectionKey(connection);
      edge.editorLabel = `${endpointLabel(connection.from)} to ${endpointLabel(connection.to)}`;
    }
    return { revision: data.revision, layout, svg: renderSvg(layout) };
  } catch (error) {
    return { revision: data.revision, error: error.message, path: error.path ?? error.cause?.path };
  }
}
