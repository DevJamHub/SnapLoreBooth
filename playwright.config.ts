import { defineConfig } from '@playwright/test';

/**
 * End-to-end checks of the guest flow and the console. They run against their own dev server on
 * port 4311 with their own data folder (.e2e-data, wiped first), so the booth's real sessions are
 * never touched. Guests pay through a stand-in for Xendit and the camera is Chrome's fake one. Uses the installed Google
 * Chrome by default; PW_CHANNEL=chromium uses Playwright's own (npx playwright install chromium).
 */
const PORT = 4311;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: process.env.PW_CHANNEL ?? 'chrome',
    viewport: { width: 1280, height: 800 },
    permissions: ['camera'],
    launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `rm -rf .e2e-data && npx next dev -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
    // Guests pay through the offline Xendit stand-in (see lib/xendit.ts), never the real one.
    env: { BOOTH_DATA_DIR: '.e2e-data', NEXT_DIST_DIR: '.next-e2e', CAMERA_SOURCE: 'browser', OPERATOR_PASSWORD: 'e2e', XENDIT_SECRET_KEY: 'mock', XENDIT_CALLBACK_TOKEN: 'e2e' },
  },
});
