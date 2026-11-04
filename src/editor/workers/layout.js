import { createDiagramModel, layoutDiagram, renderSvg } from '../../lib/index.js';
import { connectionKey } from '../state/commands.js';

self.addEventListener('message', async ({ data }) => {
  // ELK's bundled worker can assign self.onmessage internally. Keep our document
  // listener independent so an idle worker can handle subsequent layout jobs.
  if (!data?.document || !Number.isInteger(data.revision)) return;
  try {
    const layout = await layoutDiagram(createDiagramModel(data.document), { rootGroupId: data.rootGroupId });
    // Bind hit targets to this layout's document, never to a later array index.
    for (const edge of layout.connections) {
      const connection = data.document.connections[Number(edge.id.slice('connection_'.length))];
      edge.editorKey = connectionKey(connection);
      edge.editorLabel = `${connection.from} to ${connection.to}`;
    }
    self.postMessage({ revision: data.revision, layout, svg: renderSvg(layout) });
  } catch (error) {
    self.postMessage({
      revision: data.revision,
      error: error.message,
      path: error.path ?? error.cause?.path,
    });
  }
});
