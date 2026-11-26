// The Story editor's model is the runtime story contract (docs/story-runtime.md,
// schema/story.schema.json). Format, validation, SVG reference index, problems, page sources
// and fingerprints all come from src/lib/story; the GUI keeps no copy of these checks.
// This file stays as the editor's import point: the Agent Kit build resolves export.js's
// `./model.js` import to the same runtime module.
export * from '../lib/story/model.js';
