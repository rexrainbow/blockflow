import { createStatechartModel, layoutStatechart, renderStatechartSvg } from '../../lib/statechart/index.js';
export async function runLayoutJob(data) {
  if (!data?.document || !Number.isInteger(data.revision)) return null;
  try {
    const layout = await layoutStatechart(createStatechartModel(data.document));
    const svg = renderStatechartSvg(layout) + '\n';
    for (const t of layout.transitions) t.editorKey = t.id;
    return { revision: data.revision, layout, svg };
  } catch (error) {
    return { revision: data.revision, error: error.message, path: error.path ?? error.cause?.path };
  }
}
