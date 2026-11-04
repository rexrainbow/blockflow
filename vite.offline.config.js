import { defineConfig, mergeConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import webConfig from './vite.config.js';

export default mergeConfig(
  webConfig,
  defineConfig({
    resolve: {
      alias: [
        {
          find: './worker-factory.js',
          replacement: fileURLToPath(
            new URL('./src/editor/services/worker-factory.offline.js', import.meta.url),
          ),
        },
      ],
    },
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
