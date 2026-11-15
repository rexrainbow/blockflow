import './styles/tokens.css';
import './styles/studio.css';
import { startStudio } from './app.js';

// Exposed for end-to-end tests and debugging (read-only use).
window.__studio = startStudio(document.querySelector('#app'));
