import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  base: './',
  server: { host: '127.0.0.1', port: 5173, strictPort: false },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  worker: { format: 'es' },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 2000,
    // Two pages: the Studio and the Story editor (presentations of Block diagrams).
    rolldownOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        story: fileURLToPath(new URL('./story.html', import.meta.url)),
      },
    },
  },
});
