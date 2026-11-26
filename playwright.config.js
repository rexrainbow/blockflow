import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  // studio.spec.js (Block diagram), flowchart.spec.js and statechart.spec.js cover the current UI (src/studio);
  // story.spec.js covers the Story editor (story.html, src/story), wave.spec.js the Waveform
  // editor (wave.html, src/wave).
  testMatch: [
    'studio.spec.js',
    'story.spec.js',
    'wave.spec.js',
    'flowchart.spec.js',
    'statechart.spec.js',
    'alignment.spec.js',
  ],
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 10000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run preview',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
