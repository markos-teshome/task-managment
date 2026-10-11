import fs from 'node:fs';
import { defineConfig, devices } from '@playwright/test';

/**
 * Production smoke test: the backend runs with NODE_ENV=production and serves the BUILT frontend (frontend/dist)
 * on one address, exactly as the Docker image does. Run `npm run build` first. Uses the TEST database (reset
 * and seeded by e2e/global-setup.js); never point it at real data.
 *   npm run build && npx playwright test -c playwright.prod.config.js
 */
const backendEnvFile = new URL('../backend/.env', import.meta.url);
const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  (fs.existsSync(backendEnvFile) ? fs.readFileSync(backendEnvFile, 'utf8').match(/^TEST_DATABASE_URL=(\S+)/m)?.[1] : undefined);
if (!testDatabaseUrl) throw new Error('Set TEST_DATABASE_URL (backend/.env).');
process.env.E2E_DATABASE_URL = testDatabaseUrl;

const APP = 'http://localhost:4700';

export default defineConfig({
  testDir: './e2e-prod',
  globalSetup: './e2e/global-setup.js',
  workers: 1,
  timeout: 60_000,
  reporter: [['list']],
  use: { baseURL: APP, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: [
    { command: 'node e2e/fake-chapa-server.mjs', url: 'http://localhost:4900/health', reuseExistingServer: false, timeout: 30_000 },
    {
      command: 'node scripts/migrate-deploy.js && node src/server.js',
      cwd: '../backend',
      url: `${APP}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        NODE_ENV: 'production',
        SERVE_FRONTEND: 'true',
        DATABASE_URL: testDatabaseUrl,
        DIRECT_URL: '',
        PORT: '4700',
        // Production requires https public URLs (used in email links and Chapa callbacks, not for browsing here).
        APP_URL: 'https://teamflow.example.test',
        API_URL: 'https://teamflow.example.test',
        CORS_ORIGINS: 'https://teamflow.example.test',
        COOKIE_SECURE: 'true', // browsers accept Secure cookies on http://localhost
        JWT_ACCESS_SECRET: 'prod-smoke-only-secret-prod-smoke-only-secret-1',
        CHAPA_SECRET_KEY: 'CHASECK_TEST-prod-smoke',
        CHAPA_WEBHOOK_SECRET: 'prod-smoke-webhook',
        CHAPA_BASE_URL: 'http://localhost:4900/v1',
        SMTP_HOST: 'localhost', // not contacted by this smoke test
        SMTP_PORT: '2525',
        SMTP_USER: 'smoke',
        SMTP_PASS: 'smoke',
        LOG_LEVEL: 'warn',
      },
    },
  ],
  projects: [{ name: 'production', use: { ...devices['Desktop Chrome'], channel: process.env.PW_CHANNEL ?? 'chrome' } }],
});
