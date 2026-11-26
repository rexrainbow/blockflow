import '../studio/styles/tokens.css';
import '../studio/styles/studio.css';
import { StoryEditor } from './editor.js';

// Exposed for end-to-end tests and debugging (read-only use).
window.__story = new StoryEditor(document.querySelector('#app'));
