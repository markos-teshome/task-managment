/**
 * Applies pending migrations (prisma migrate deploy) over a DIRECT database connection when DIRECT_URL is set.
 * Neon's pooled "-pooler" address can leave Prisma's migration lock stuck on a shared connection, so every
 * later deploy times out (P1002). The app itself keeps using the pooled DATABASE_URL.
 *
 *   npm run db:deploy
 */
import 'dotenv/config';
import { spawnSync } from 'node:child_process';

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url) {
  console.error('Set DATABASE_URL (and preferably DIRECT_URL, the non-pooled address) before running migrations.');
  process.exit(1);
}
if (!process.env.DIRECT_URL && url.includes('-pooler')) {
  console.warn('DIRECT_URL is not set and DATABASE_URL is a pooled address: if this times out, set DIRECT_URL (same URL without "-pooler").');
}
const result = spawnSync('npx', ['prisma', 'migrate', 'deploy'], { stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, DATABASE_URL: url } });
process.exit(result.status ?? 1);
