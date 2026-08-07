import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';

/**
 * Writes a local `apps/mobile/.env` pointed at this machine's LAN address.
 *
 * A development build runs on a physical iPhone, and `localhost` on that phone
 * is the phone. Every request to the API has to go to the address the phone can
 * actually reach, which changes whenever the network does -- so it is detected
 * rather than written down.
 *
 * Override with `--host=<address>` when the guess is wrong (multiple adapters,
 * a VPN, a tethered connection).
 */

const exampleUrl = new URL('../.env.example', import.meta.url);
const targetUrl = new URL('../.env', import.meta.url);
const force = process.argv.includes('--force');
const hostArgument = process.argv
  .find((argument) => argument.startsWith('--host='))
  ?.slice('--host='.length)
  .trim();

/** Private ranges only, most-likely-first. A VPN or public address is not a LAN. */
function rankAddress(address) {
  if (address.startsWith('192.168.')) {
    return 0;
  }
  if (address.startsWith('10.')) {
    return 1;
  }
  const octets = address.split('.');
  const second = Number(octets[1]);
  if (octets[0] === '172' && Number.isInteger(second) && second >= 16 && second <= 31) {
    return 2;
  }
  return Number.POSITIVE_INFINITY;
}

function detectLanAddress() {
  const candidates = [];
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family !== 'IPv4' || address.internal) {
        continue;
      }
      const rank = rankAddress(address.address);
      if (Number.isFinite(rank)) {
        candidates.push({ address: address.address, rank });
      }
    }
  }
  candidates.sort((left, right) => left.rank - right.rank);
  return candidates[0]?.address;
}

const host =
  hostArgument !== undefined && hostArgument.length > 0 ? hostArgument : detectLanAddress();
if (host === undefined) {
  throw new Error(
    'No private IPv4 address was found. Connect to a network, or pass --host=<address>.',
  );
}

if (existsSync(targetUrl) && !force) {
  const current = await readFile(targetUrl, 'utf8');
  const configured = /^EXPO_PUBLIC_API_URL=(.*)$/mu.exec(current)?.[1]?.trim();
  process.stdout.write(
    [
      `apps/mobile/.env already exists with EXPO_PUBLIC_API_URL=${configured ?? '(unset)'}.`,
      `This machine's LAN address is http://${host}:3000.`,
      'Pass --force to rewrite it.',
      '',
    ].join('\n'),
  );
  process.exit(0);
}

const example = await readFile(exampleUrl, 'utf8');
const contents = example.replace(
  /^EXPO_PUBLIC_API_URL=.*$/mu,
  `EXPO_PUBLIC_API_URL=http://${host}:3000`,
);
if (!contents.includes(`http://${host}:3000`)) {
  throw new Error('EXPO_PUBLIC_API_URL was not found in .env.example; refusing to write .env.');
}

await writeFile(targetUrl, contents, 'utf8');
process.stdout.write(
  [
    `Wrote apps/mobile/.env with EXPO_PUBLIC_API_URL=http://${host}:3000.`,
    'Only public values live here. Re-run with --force whenever your network changes.',
    '',
  ].join('\n'),
);
