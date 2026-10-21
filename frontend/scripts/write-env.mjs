// Copies the browser-safe settings from .env / .env.local into public/env.json,
// because the app runs in the browser and cannot read .env files itself.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

const root = new URL('../', import.meta.url);
const files = ['.env', '.env.local']; // later files win

const env = {};
for (const name of files) {
  const file = new URL(name, root);
  if (existsSync(file)) Object.assign(env, parseEnv(readFileSync(file, 'utf8')));
}

// Only allowlisted keys reach the browser; everything else in .env stays private
const output = {};
if (env.ORDERS_API_BASE_URL) output.ordersApiBaseUrl = env.ORDERS_API_BASE_URL;

writeFileSync(new URL('public/env.json', root), JSON.stringify(output, null, 2) + '\n');
console.log(`public/env.json: ${output.ordersApiBaseUrl ? `ordersApiBaseUrl=${output.ordersApiBaseUrl}` : 'no ORDERS_API_BASE_URL set'}`);
