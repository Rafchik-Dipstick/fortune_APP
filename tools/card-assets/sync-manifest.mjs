import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fullDeckCards, fullDeckPromptTemplateVersion } from './full-deck-catalog.mjs';

const toolsDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(toolsDirectory, '..', '..');
const manifestUrl = new URL('./manifest.json', import.meta.url);
const previousManifest = JSON.parse(await readFile(manifestUrl, 'utf8'));
const promptCatalog = JSON.parse(
  await readFile(new URL('./prompts/full-deck-v1.json', import.meta.url), 'utf8'),
);
const previousByKey = new Map(previousManifest.cards.map((card) => [card.key, card]));
const sourceDirectory = resolve(toolsDirectory, 'source');
const sourceFileNames = new Set(
  (await readdir(sourceDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.png'))
    .map((entry) => entry.name),
);

function readPngMetadata(buffer, path) {
  if (buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    throw new Error(`${path} is not a PNG.`);
  }

  const colorType = buffer.readUInt8(25);
  const colorModes = { 0: 'L', 2: 'RGB', 3: 'P', 4: 'LA', 6: 'RGBA' };
  const colorMode = colorModes[colorType];
  if (!colorMode) {
    throw new Error(`${path} uses unsupported PNG color type ${String(colorType)}.`);
  }

  return {
    colorMode,
    height: buffer.readUInt32BE(20),
    width: buffer.readUInt32BE(16),
  };
}

const knownFileNames = new Set(fullDeckCards.map((deckCard) => `${deckCard.key}.png`));
for (const fileName of sourceFileNames) {
  if (!knownFileNames.has(fileName)) {
    throw new Error(`Unknown source PNG cannot be manifested: ${fileName}.`);
  }
}

const cards = [];
for (const deckCard of fullDeckCards) {
  const fileName = `${deckCard.key}.png`;
  if (!sourceFileNames.has(fileName)) {
    continue;
  }

  const sourceOutputPath = `tools/card-assets/source/${fileName}`;
  const absolutePath = resolve(repositoryRoot, sourceOutputPath);
  const buffer = await readFile(absolutePath);
  const fileStat = await stat(absolutePath);
  const metadata = readPngMetadata(buffer, sourceOutputPath);
  const previous = previousByKey.get(deckCard.key);
  const prompt = promptCatalog.prompts[deckCard.key];

  cards.push({
    key: deckCard.key,
    promptKey: deckCard.key,
    promptTextSha256: createHash('sha256').update(prompt, 'utf8').digest('hex'),
    provider: 'google-vertex-adc',
    model: 'gemini-3.1-flash-image',
    sourceOutputPath,
    bundledPath: sourceOutputPath,
    width: metadata.width,
    height: metadata.height,
    colorMode: metadata.colorMode,
    bytes: fileStat.size,
    sha256: createHash('sha256').update(buffer).digest('hex'),
    localizedAltText: { en: deckCard.altText },
    reviewStatus: previous?.reviewStatus ?? 'GENERATED_UNREVIEWED',
    reviewNotes:
      previous?.reviewNotes ??
      'Generated from the full-deck unreviewed prompt catalog. Human source, coded-frame, accessibility, and device review remain open.',
  });
}

const manifest = {
  schemaVersion: 1,
  promptTemplateVersion: fullDeckPromptTemplateVersion,
  promptSourcePath: 'tools/card-assets/prompts/full-deck-v1.json',
  expectedCardCount: fullDeckCards.length,
  cards,
};

await writeFile(manifestUrl, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
process.stdout.write(
  `Manifested ${String(cards.length)}/${String(fullDeckCards.length)} full-deck source PNGs.\n`,
);
