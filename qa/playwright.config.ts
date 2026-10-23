import { defineConfig } from '@playwright/test';

// The fieldkit stack must be running: web on :4173 (proxying :8090), or set
// FIELDKIT_WEB and FIELDKIT_API to a deployment. `pnpm preview` serves the real
// production build with its service worker, which is what we want to prove.
export default defineConfig({
  testDir: './tests',
  globalSetup: './tests/global-setup.ts',
  timeout: 420_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'report' }]],
  outputDir: 'artifacts/raw',
  use: {
    headless: true,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'fieldkit', testMatch: /fieldkit\.spec\.ts/ }],
});
