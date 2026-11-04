import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const design = readFileSync('DESIGN.md', 'utf8');
const css = readFileSync('src/editor/styles/tokens.css', 'utf8');
const colors = design.match(/colors:\n([\s\S]*?)\ntypography:/)[1];
for (const [, name, color] of colors.matchAll(/  ([\w-]+): ['"](#[0-9a-fA-F]+)['"]/g)) {
  assert.ok(css.includes(`--${name}: ${color};`), `Token drift: ${name}`);
}
for (const name of ['Select/Listbox', 'Form', 'Scrollbar', 'Toast', 'CRUD'])
  assert.ok(new RegExp(`\\|\\s*${name}\\s*\\|`).test(readFileSync('UX-CONTRACT.md', 'utf8')));
console.log('Design color tokens and canonical capability ownership verified.');
