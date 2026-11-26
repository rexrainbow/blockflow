import { defineConfig, mergeConfig } from 'vite';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rmSync, writeFileSync, mkdirSync } from 'node:fs';
import webConfig from './vite.config.js';

const slash = (path) => path.replaceAll('\\', '/');
const editorRoot = slash(fileURLToPath(new URL('./src/editor/', import.meta.url)));
const offlineRoot = fileURLToPath(new URL('./dist-offline/', import.meta.url));

/**
 * The portable build is one folder per page, each opened from file:// on its own:
 *   dist-offline/index.html   chooser linking the pages
 *   dist-offline/studio/      the Studio (`vite build --config vite.offline.config.js`)
 *   dist-offline/story/       the Story editor (`... --mode story`)
 *   dist-offline/wave/        the Waveform editor (`... --mode wave`)
 * One classic script cannot hold two pages, so each page is its own build.
 */
// Each page's html entry and where it finds its sibling pages (see src/story/handoff.js).
const PAGES = {
  studio: { html: './index.html', define: { __BLOCKFLOW_STORY_PAGE__: '../story/index.html' } },
  story: {
    html: './story.html',
    define: {
      __BLOCKFLOW_STUDIO_PAGE__: '../studio/index.html',
      __BLOCKFLOW_WAVE_PAGE__: '../wave/index.html',
    },
  },
  wave: { html: './wave.html', define: { __BLOCKFLOW_STUDIO_PAGE__: '../studio/index.html' } },
};

/**
 * Offline bundles use each diagram domain's inline Worker factory. A domain service at
 * src/editor/<domain>/services/ imports './worker-factory.js'; this resolves it to the
 * sibling worker-factory.offline.js of the same domain, so a Flowchart service can never
 * be redirected to the Blockchart Worker.
 */
const domainOfflineWorkers = {
  name: 'domain-offline-workers',
  enforce: 'pre',
  resolveId(source, importer) {
    if (source !== './worker-factory.js' || !importer) return null;
    const dir = posix.dirname(slash(importer.split('?')[0]));
    const rel = dir.startsWith(editorRoot) ? dir.slice(editorRoot.length).split('/') : [];
    if (rel.length !== 2 || rel[1] !== 'services' || rel[0] === 'shared') return null;
    return `${dir}/worker-factory.offline.js`;
  },
};

const CHOOSER = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>blockflow offline</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-content: center; gap: 16px; padding: 24px;
        font: 15px/1.5 'Segoe UI', system-ui, sans-serif; color: #1b1f24; background: #f4f5f7; }
      h1 { margin: 0; font-size: 20px; }
      a { display: block; padding: 14px 18px; border: 1px solid #dde1e6; border-radius: 8px; background: #fff;
        color: inherit; text-decoration: none; max-width: 420px; }
      a:hover { border-color: #2457d6; }
      strong { color: #2457d6; }
      @media (prefers-color-scheme: dark) {
        body { color: #e6e9ee; background: #121926; }
        a { background: #1b2433; border-color: #2c3748; }
        strong { color: #8fb0ff; }
      }
    </style>
  </head>
  <body>
    <h1>blockflow offline</h1>
    <a href="./studio/index.html"><strong>Studio</strong><br />Edit Block diagrams, flowcharts and statecharts.</a>
    <a href="./story/index.html"><strong>Story editor</strong><br />Present a Block diagram step by step and export one HTML page.</a>
    <a href="./wave/index.html"><strong>Waveform editor</strong><br />Draw synchronous timing diagrams; import VCD from a simulation.</a>
  </body>
</html>
`;

/** Writes the chooser and removes files a single-page build left at the folder root. */
const offlineFolder = {
  name: 'offline-folder',
  apply: 'build',
  closeBundle() {
    mkdirSync(offlineRoot, { recursive: true });
    for (const stale of ['app.js', 'style.css', 'assets'])
      rmSync(offlineRoot + stale, { recursive: true, force: true });
    writeFileSync(offlineRoot + 'index.html', CHOOSER);
  },
};

export default defineConfig(({ mode }) => {
  const page = Object.hasOwn(PAGES, mode) ? mode : 'studio';
  const { html, define } = PAGES[page];
  const single = {
    ...webConfig,
    build: { ...webConfig.build, rolldownOptions: { ...webConfig.build.rolldownOptions, input: undefined } },
  };
  return mergeConfig(single, {
    worker: { format: 'iife' },
    define: Object.fromEntries(Object.entries(define).map(([k, v]) => [k, JSON.stringify(v)])),
    build: {
      outDir: `dist-offline/${page}`,
      emptyOutDir: true,
      cssCodeSplit: false,
      modulePreload: false,
      rolldownOptions: {
        input: fileURLToPath(new URL(html, import.meta.url)),
        output: {
          format: 'iife',
          entryFileNames: 'app.js',
          assetFileNames: (asset) =>
            asset.names.some((name) => name.endsWith('.css')) ? 'style.css' : 'assets/[name]-[hash][extname]',
        },
      },
    },
    plugins: [
      domainOfflineWorkers,
      {
        name: 'offline-classic-html',
        transformIndexHtml: {
          order: 'post',
          handler(source) {
            // Classic scripts and CSS load from file:// without module/CORS requests.
            return source.replace('type="module"', 'defer').replaceAll(' crossorigin', '');
          },
        },
      },
      {
        // Each folder opens with index.html, whichever page it holds.
        name: 'offline-page-name',
        enforce: 'post',
        generateBundle(_, bundle) {
          for (const file of Object.values(bundle))
            if (/^(story|wave)\.html$/.test(file.fileName)) file.fileName = 'index.html';
        },
      },
      offlineFolder,
    ],
  });
});
