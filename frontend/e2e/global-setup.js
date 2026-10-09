import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Known demo data in the isolated TEST database for every run (never the development database). */
export default function globalSetup() {
  const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../backend');
  execSync('npx prisma migrate deploy && node prisma/seed.js', {
    cwd: backend,
    stdio: 'ignore',
    env: { ...process.env, DATABASE_URL: process.env.E2E_DATABASE_URL, NODE_ENV: 'test', SEED_FORCE: '1' },
  });
}
