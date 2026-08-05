import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const toolsDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(toolsDirectory, '..', '..');
const manifestUrl = new URL('./manifest.json', import.meta.url);
const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function countWords(value) {
  return value.trim().split(/\s+/u).filter(Boolean).length;
}

function normalizeRepositoryPath(path) {
  return path.replaceAll('\\', '/');
}

function readPngDimensions(buffer, path) {
  const pngSignature = '89504e470d0a1a0a';
  assert(buffer.subarray(0, 8).toString('hex') === pngSignature, `${path} is not a PNG file.`);
  assert(buffer.subarray(12, 16).toString('ascii') === 'IHDR', `${path} has no PNG IHDR.`);

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

assert(manifest.schemaVersion === 1, 'Asset manifest schemaVersion must be 1.');
assert(
  typeof manifest.promptTemplateVersion === 'string' && manifest.promptTemplateVersion.length > 0,
  'Asset manifest needs a promptTemplateVersion.',
);
assert(
  typeof manifest.promptSourcePath === 'string' && manifest.promptSourcePath.length > 0,
  'Asset manifest needs a promptSourcePath.',
);
assert(Array.isArray(manifest.cards), 'Asset manifest cards must be an array.');

const normalizedPromptSourcePath = normalizeRepositoryPath(manifest.promptSourcePath);
assert(
  !normalizedPromptSourcePath.startsWith('../') && !normalizedPromptSourcePath.startsWith('/'),
  'Asset promptSourcePath must stay inside the repository.',
);
const promptCatalog = JSON.parse(
  await readFile(resolve(repositoryRoot, manifest.promptSourcePath), 'utf8'),
);
assert(promptCatalog.schemaVersion === 1, 'Card prompt catalog schemaVersion must be 1.');
assert(
  promptCatalog.promptTemplateVersion === manifest.promptTemplateVersion,
  'Card prompt catalog version must match the asset manifest.',
);
assert(
  promptCatalog.prompts && typeof promptCatalog.prompts === 'object',
  'Card prompt catalog prompts are required.',
);

const cardKeys = new Set();
const checksums = new Set();
const manifestedPaths = new Set();
const referencedPrompts = new Set();

for (const [index, card] of manifest.cards.entries()) {
  const prefix = `cards[${String(index)}]`;
  assert(typeof card.key === 'string' && card.key.length > 0, `${prefix}.key is required.`);
  assert(!cardKeys.has(card.key), `Duplicate asset manifest card key: ${card.key}.`);
  cardKeys.add(card.key);

  assert(
    typeof card.promptKey === 'string' && card.promptKey.length > 0,
    `${prefix}.promptKey is required.`,
  );
  assert(
    !referencedPrompts.has(card.promptKey),
    `Duplicate prompt key reference: ${card.promptKey}.`,
  );
  referencedPrompts.add(card.promptKey);
  const prompt = promptCatalog.prompts[card.promptKey];
  assert(
    typeof prompt === 'string' && prompt.length > 0,
    `${prefix}.promptKey is missing from the prompt catalog.`,
  );
  const promptChecksum = createHash('sha256').update(prompt, 'utf8').digest('hex');
  assert(
    promptChecksum === card.promptTextSha256,
    `${prefix}.promptTextSha256 does not match its prompt.`,
  );

  assert(
    typeof card.sourceOutputPath === 'string' && card.sourceOutputPath.length > 0,
    `${prefix}.sourceOutputPath is required.`,
  );
  const normalizedSourcePath = normalizeRepositoryPath(card.sourceOutputPath);
  assert(
    !normalizedSourcePath.startsWith('../') && !normalizedSourcePath.startsWith('/'),
    `${prefix}.sourceOutputPath must stay inside the repository.`,
  );
  manifestedPaths.add(normalizedSourcePath);

  const absoluteSourcePath = resolve(repositoryRoot, card.sourceOutputPath);
  const sourceBuffer = await readFile(absoluteSourcePath);
  const sourceStat = await stat(absoluteSourcePath);
  const dimensions = readPngDimensions(sourceBuffer, normalizedSourcePath);
  const checksum = createHash('sha256').update(sourceBuffer).digest('hex');

  assert(dimensions.width === card.width, `${prefix}.width does not match the PNG.`);
  assert(dimensions.height === card.height, `${prefix}.height does not match the PNG.`);
  assert(sourceStat.size === card.bytes, `${prefix}.bytes does not match the PNG.`);
  assert(card.bytes <= 4_000_000, `${normalizedSourcePath} exceeds the 4 MB proof limit.`);
  assert(checksum === card.sha256, `${prefix}.sha256 does not match the PNG.`);
  assert(!checksums.has(checksum), `Duplicate asset checksum: ${checksum}.`);
  checksums.add(checksum);

  const aspectRatioDifference = Math.abs(dimensions.width / dimensions.height - 2 / 3);
  assert(
    aspectRatioDifference <= 0.01,
    `${normalizedSourcePath} must remain within 0.01 of the 2:3 card ratio.`,
  );

  assert(
    card.localizedAltText && typeof card.localizedAltText.en === 'string',
    `${prefix}.localizedAltText.en is required.`,
  );
  const altWords = countWords(card.localizedAltText.en);
  assert(altWords >= 8 && altWords <= 25, `${prefix}.localizedAltText.en must be 8–25 words.`);
  assert(
    ['GENERATED_UNREVIEWED', 'READY_FOR_REVIEW', 'APPROVED'].includes(card.reviewStatus),
    `${prefix}.reviewStatus is invalid.`,
  );
}

const sourceDirectory = resolve(toolsDirectory, 'source');
const generatedFiles = (await readdir(sourceDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.toLocaleLowerCase('en').endsWith('.png'))
  .map((entry) =>
    normalizeRepositoryPath(relative(repositoryRoot, resolve(sourceDirectory, entry.name))),
  );

for (const generatedPath of generatedFiles) {
  assert(
    manifestedPaths.has(generatedPath),
    `Generated PNG lacks a manifest entry: ${generatedPath}.`,
  );
}

assert(
  Object.keys(promptCatalog.prompts).length === referencedPrompts.size,
  'Card prompt catalog contains an unreferenced prompt.',
);

process.stdout.write(
  `Card asset manifest is valid (${String(cardKeys.size)}/3 Phase 2 proofs recorded).\n`,
);
