import 'dotenv/config';

// Runs before any application module is imported, in every test worker.
if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL must be set to run tests');
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.RATE_LIMIT_ENABLED = 'false';
process.env.BCRYPT_ROUNDS = '4';
// Chapa test-mode credentials for the test run; Chapa's HTTP API itself is faked (no network).
process.env.CHAPA_SECRET_KEY = 'CHASECK_TEST-test-secret-key';
process.env.CHAPA_WEBHOOK_SECRET = 'test-webhook-secret-hash';
globalThis.fetch = (await import('./fakeChapa.js')).fakeChapaFetch;
process.env.JWT_ACCESS_SECRET ??= 'test-secret-test-secret-test-secret-123';
