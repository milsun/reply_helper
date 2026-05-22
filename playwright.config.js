// @ts-check
const { defineConfig, devices } = require('@playwright/test');
const path = require('path');

module.exports = defineConfig({
  testDir: './test/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['html', { outputFolder: 'test/reports' }],
    ['list']
  ],
  timeout: 30000,

  use: {
    baseURL: 'http://localhost:0',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            `--disable-extensions-except=${path.resolve(__dirname, '../')}`,
            `--load-extension=${path.resolve(__dirname, '../')}`,
            '--disable-features=DialMediaRouteProvider'
          ],
        },
      },
    },
  ],
});
