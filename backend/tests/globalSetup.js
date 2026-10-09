import 'dotenv/config';
import { execSync } from 'node:child_process';

/**
 * Applies all migrations to the dedicated test database (non-destructive `migrate deploy`).
 * Each test file then empties the tenant tables itself (see helpers.resetDb).
 */
export default function setup() {
  if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL must be set to run tests');
  if (process.env.TEST_DATABASE_URL === process.env.DATABASE_URL) {
    throw new Error('TEST_DATABASE_URL must differ from DATABASE_URL — tests delete data in it');
  }
  execSync('npx prisma migrate deploy', {
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL },
  });
}
