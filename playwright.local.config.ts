import { defineConfig } from '@playwright/test';
import baseConfig from './playwright.config';

/**
 * Temporary local verification config: run the suite against the dev server
 * already listening on :3002 (the docker web container owns :3000).
 */
export default defineConfig({
  ...baseConfig,
  use: {
    ...baseConfig.use,
    baseURL: 'http://localhost:3002',
  },
  webServer: undefined,
});
