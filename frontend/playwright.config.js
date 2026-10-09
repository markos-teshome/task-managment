import fs from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against their own isolated stack, started here:
 *   fake Chapa (:4900) → TeamFlow API (:4300, TEST database) → Vite frontend (:5400)
 * The real application code runs unchanged; only Chapa is replaced by e2e/fake-chapa-server.mjs,
 * so tests never touch live services, your development database or your running servers.
 * Requires TEST_DATABASE_URL in backend/.env. Uses an installed browser (PW_CHANNEL, default "chrome").
 */
const channel = process.env.PW_CHANNEL ?? 'chrome';

const backendEnvFile = new URL('../backend/.env', import.meta.url);
const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  (fs.existsSync(backendEnvFile) ? fs.readFileSync(backendEnvFile, 'utf8').match(/^TEST_DATABASE_URL=(\S+)/m)?.[1] : undefined);
if (!testDatabaseUrl) throw new Error('Set TEST_DATABASE_URL (backend/.env) — e2e tests reset that database.');
process.env.E2E_DATABASE_URL = testDatabaseUrl; // used by global-setup to seed the same database

const API = 'http://localhost:4300';
const APP = 'http://localhost:5400';

export default defineConfig({
  testDir: './e2e',
  testMatch: /\.spec\.js$/,
  globalSetup: './e2e/global-setup.js',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: { baseURL: APP, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: [
    { command: 'node e2e/fake-chapa-server.mjs', url: 'http://localhost:4900/health', reuseExistingServer: false, timeout: 30_000 },
    {
      command: 'npx prisma migrate deploy && node src/server.js',
      cwd: '../backend',
      url: `${API}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        NODE_ENV: 'test', // in-memory email outbox, quiet logs
        DATABASE_URL: testDatabaseUrl,
        PORT: '4300',
        API_URL: API,
        APP_URL: APP,
        CORS_ORIGINS: APP,
        JWT_ACCESS_SECRET: 'e2e-only-secret-e2e-only-secret-e2e-only-1234',
        RATE_LIMIT_ENABLED: 'false',
        CHAPA_SECRET_KEY: 'CHASECK_TEST-e2e',
        CHAPA_WEBHOOK_SECRET: 'e2e-webhook-secret',
        CHAPA_BASE_URL: 'http://localhost:4900/v1',
      },
    },
    { command: 'npx vite --port 5400 --strictPort', url: APP, reuseExistingServer: false, timeout: 60_000, env: { VITE_PROXY_TARGET: API } },
  ],
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], channel, viewport: { width: 1440, height: 900 } }, testIgnore: /mobile\.spec/ },
    { name: 'mobile', use: { ...devices['Pixel 7'], channel }, testMatch: /mobile\.spec/ },
  ],
});
