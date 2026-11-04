import { defineConfig } from '@playwright/test';
import webConfig from './playwright.config.js';

export default defineConfig({
  ...webConfig,
  testMatch: 'offline.spec.js',
  webServer: undefined,
  use: {
    ...webConfig.use,
    baseURL: undefined,
    offline: true,
    serviceWorkers: 'block',
  },
});
