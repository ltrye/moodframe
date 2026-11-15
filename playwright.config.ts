import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests', testMatch: 'player.spec.ts', workers: 1, timeout: 30_000,
  outputDir: 'artifacts/browser-results', reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:1433', headless: true, viewport: { width: 1280, height: 900 },
    channel: 'msedge',
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] }
  },
  webServer: { command: 'npx vite --host 127.0.0.1 --port 1433 --strictPort', url: 'http://127.0.0.1:1433/tests/player.html', reuseExistingServer: false, timeout: 30_000 }
});
