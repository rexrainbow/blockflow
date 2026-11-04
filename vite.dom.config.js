import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('./examples/', import.meta.url)),
  base: './',
  build: {
    outDir: fileURLToPath(new URL('./dist-dom/', import.meta.url)),
    emptyOutDir: true,
    cssCodeSplit: false,
    modulePreload: false,
    chunkSizeWarningLimit: 2000,
    rolldownOptions: {
      input: fileURLToPath(new URL('./examples/dom-viewer.html', import.meta.url)),
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
      name: 'dom-example-classic-html',
      transformIndexHtml: {
        order: 'post',
        handler: (html) => html.replace('type="module"', 'defer').replaceAll(' crossorigin', ''),
      },
    },
  ],
});
