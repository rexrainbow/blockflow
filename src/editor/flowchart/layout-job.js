import { createFlowchartModel, layoutFlowchart, renderFlowchartSvg } from '../../lib/flowchart/index.js';

export async function runLayoutJob(data) {
  if (!data?.document || !Number.isInteger(data.revision)) return null;
  try {
    const layout = await layoutFlowchart(createFlowchartModel(data.document));
    // SVG is rendered before editor-only metadata is added.
    const svg = renderFlowchartSvg(layout) + '\n';
    for (const edge of layout.edges) edge.editorKey = edge.id;
    return { revision: data.revision, layout, svg };
  } catch (error) {
    return { revision: data.revision, error: error.message, path: error.path ?? error.cause?.path };
  }
}
