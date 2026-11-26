import '../studio/styles/tokens.css';
import '../studio/styles/studio.css';
import '../story/story.css';
import { WaveEditor } from './editor.js';

// Exposed for end-to-end tests and debugging (read-only use).
window.__wave = new WaveEditor(document.querySelector('#app'));
