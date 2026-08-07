import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';

/**
 * Writes a local `apps/api/.env` from `.env.example`, replacing every key
 * placeholder with real material. The API refuses to boot on the placeholders,
 * and hand-rolling eight 32-byte keyrings is the step everyone gets wrong.
 *
 * Development only. It never touches an existing file without `--force`, and
 * the values it writes are for a local database that holds nothing real.
 */

const placeholder = 'replace-with-base64-key';
const exampleUrl = new URL('../.env.example', import.meta.url);
const targetUrl = new URL('../.env', import.meta.url);
const force = process.argv.includes('--force');

if (existsSync(targetUrl) && !force) {
  process.stdout.write(
    'apps/api/.env already exists; leaving it alone. Pass --force to regenerate it.\n',
  );
  process.exit(0);
}

/** Canonical base64 for exactly 32 bytes, which is what `keyRingSchema` accepts. */
function generateKey() {
  return randomBytes(32).toString('base64');
}

const example = await readFile(exampleUrl, 'utf8');
let generated = 0;
const contents = example.replaceAll(placeholder, () => {
  generated += 1;
  return generateKey();
});

if (generated === 0) {
  throw new Error('No key placeholders were found in .env.example; refusing to write a stub .env.');
}
if (contents.includes(placeholder)) {
  throw new Error('A key placeholder survived generation; refusing to write an unusable .env.');
}

await writeFile(targetUrl, contents, { encoding: 'utf8', mode: 0o600 });
process.stdout.write(
  [
    `Wrote apps/api/.env with ${String(generated)} freshly generated local keys.`,
    'It is gitignored. Apple commerce credentials stay blank until sandbox testing needs them.',
    '',
  ].join('\n'),
);
