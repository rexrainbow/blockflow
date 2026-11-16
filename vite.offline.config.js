import { defineConfig, mergeConfig } from 'vite';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import webConfig from './vite.config.js';

const slash = (path) => path.replaceAll('\\', '/');
const editorRoot = slash(fileURLToPath(new URL('./src/editor/', import.meta.url)));

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
export default mergeConfig(
  webConfig,
  defineConfig({
    worker: { format: 'iife' },
    build: {
      outDir: 'dist-offline',
      cssCodeSplit: false,
      modulePreload: false,
      rolldownOptions: {
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
          handler(html) {
            // Classic scripts and CSS load from file:// without module/CORS requests.
            return html.replace('type="module"', 'defer').replaceAll(' crossorigin', '');
          },
        },
      },
    ],
  }),
);
