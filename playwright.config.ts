import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5180',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      ...(existsSync('/usr/bin/chromium') ? { executablePath: '/usr/bin/chromium' } : {}),
      args: ['--no-sandbox'],
    },
  },
  webServer: {
    command:
      'npx cross-env PORT=3002 APP_ORIGIN=http://localhost:5180 API_PROXY_TARGET=http://127.0.0.1:3002 DEV_DATA_PATH=.data/e2e-workspace.json concurrently -k "npm:dev:api" "vite --host 127.0.0.1 --port 5180"',
    url: 'http://localhost:5180/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
