/** Upgrade old editor files/drafts without mutating their graph or unrelated settings. */
export function migrateLegacyLayout(input) {
  const document = structuredClone(input);
  if (document && typeof document === 'object' && !Array.isArray(document)) {
    if (document.layout && typeof document.layout === 'object' && !Array.isArray(document.layout))
      delete document.layout.orderMode;
    if (Array.isArray(document.connections))
      for (const edge of document.connections) {
        if (edge && typeof edge === 'object' && !Array.isArray(edge)) {
          delete edge.order;
          delete edge.alignment;
        }
      }
  }
  return document;
}
