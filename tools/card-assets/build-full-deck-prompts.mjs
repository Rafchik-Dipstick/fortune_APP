import { readFile, writeFile } from 'node:fs/promises';

import {
  createFullDeckPrompt,
  fullDeckCards,
  fullDeckPromptTemplateVersion,
} from './full-deck-catalog.mjs';

const proofCatalog = JSON.parse(
  await readFile(new URL('./prompts/phase2-proofs.json', import.meta.url), 'utf8'),
);

if (fullDeckCards.length !== 78) {
  throw new Error(
    `Full-deck catalog must contain 78 cards, found ${String(fullDeckCards.length)}.`,
  );
}

const cardKeys = new Set(fullDeckCards.map((deckCard) => deckCard.key));
if (cardKeys.size !== fullDeckCards.length) {
  throw new Error('Full-deck catalog contains duplicate card keys.');
}

for (const deckCard of fullDeckCards) {
  const altWordCount = deckCard.altText.trim().split(/\s+/u).filter(Boolean).length;
  if (altWordCount < 8 || altWordCount > 25) {
    throw new Error(
      `${deckCard.key} draft alt text must contain 8–25 words, found ${String(altWordCount)}.`,
    );
  }
}

const prompts = Object.fromEntries(
  fullDeckCards.map((deckCard) => [
    deckCard.key,
    proofCatalog.prompts[deckCard.key] ?? createFullDeckPrompt(deckCard),
  ]),
);

const catalog = {
  schemaVersion: 1,
  promptTemplateVersion: fullDeckPromptTemplateVersion,
  expectedCardCount: fullDeckCards.length,
  cardOrder: fullDeckCards.map((deckCard) => deckCard.key),
  prompts,
};

await writeFile(
  new URL('./prompts/full-deck-v1.json', import.meta.url),
  `${JSON.stringify(catalog, null, 2)}\n`,
  'utf8',
);

process.stdout.write(
  `Wrote ${String(fullDeckCards.length)} exact prompts to tools/card-assets/prompts/full-deck-v1.json.\n`,
);
