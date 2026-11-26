// Builds the standalone presentation page: the same player code Studio runs, inlined with
// the presentation data. The page needs no network and no layout engine.
import playerJs from './player.js?raw';
import presentJs from './present.js?raw';
import playerCss from './player.css?raw';
import presentCss from './present.css?raw';
import { SOURCES_ID } from './model.js';

/** Module source as a classic script: drop imports, keep declarations. */
const classic = (source) => source.replace(/^import .*$/gm, '').replace(/^export /gm, '');
const escapeHtml = (value) => String(value).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/**
 * One offline HTML page: the player and `data` (SVG, view box, chapters) to show, plus the
 * editable `sources` ({ diagram, story }) the Story editor reads back when the page is opened.
 */
export function presentationHtml(data, sources) {
  const LS = String.fromCharCode(0x2028), PS = String.fromCharCode(0x2029);
  const BS = String.fromCharCode(92); // backslash, spelled out so no escape can be mangled
  const inline = (value) => JSON.stringify(value).replaceAll('<', BS + 'u003c').replaceAll(LS, BS + 'u2028').replaceAll(PS, BS + 'u2029');
  const json = inline(data);
  const source = sources ? `\n<script type="application/json" id="${SOURCES_ID}">${inline(sources)}</script>` : '';
  const script = `${classic(playerJs)}\n${classic(presentJs)}\nbootPresentation(JSON.parse(document.getElementById('pv-data').textContent), document.getElementById('app'));`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="blockflow Story editor">
<title>${escapeHtml(data.title || 'Presentation')}</title>
<style>
${playerCss}
${presentCss}
</style>
</head>
<body>
<div id="app"></div>
<script type="application/json" id="pv-data">${json}</script>${source}
<script>
${script.replace(/<\/script/gi, '<\\/script')}
</script>
</body>
</html>
`;
}
