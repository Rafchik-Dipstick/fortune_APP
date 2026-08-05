import { readFile } from 'node:fs/promises';

const manifestUrl = new URL('./manifest.json', import.meta.url);
const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));

if (manifest.schemaVersion !== 1) {
  throw new Error('Asset manifest schemaVersion must be 1.');
}

if (!Array.isArray(manifest.cards)) {
  throw new Error('Asset manifest cards must be an array.');
}

const cardKeys = manifest.cards.map((card) => card.key);
if (cardKeys.some((key) => typeof key !== 'string' || key.length === 0)) {
  throw new Error('Every asset manifest card needs a non-empty key.');
}

if (new Set(cardKeys).size !== cardKeys.length) {
  throw new Error('Asset manifest card keys must be unique.');
}

process.stdout.write(
  `Card asset scaffold is valid (${cardKeys.length} cards; the Phase 2 gate requires 3).\n`,
);
