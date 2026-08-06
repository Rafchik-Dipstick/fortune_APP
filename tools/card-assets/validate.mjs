import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const toolsDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(toolsDirectory, '..', '..');
const manifestUrl = new URL('./manifest.json', import.meta.url);
const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));
const cropPlan = JSON.parse(
  await readFile(new URL('./crop-plan.v1.json', import.meta.url), 'utf8'),
);

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
    colorType: buffer.readUInt8(25),
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
assert(
  manifest.expectedCardCount === 78,
  'Asset manifest expectedCardCount must be the canonical 78-card deck.',
);
assert(
  manifest.cards.length <= manifest.expectedCardCount,
  'Asset manifest cannot exceed expectedCardCount.',
);
assert(cropPlan.schemaVersion === 1, 'Card crop plan schemaVersion must be 1.');
assert(
  typeof cropPlan.normalizationVersion === 'string' && cropPlan.normalizationVersion.length > 0,
  'Card crop plan needs a normalizationVersion.',
);
assert(
  cropPlan.outputWidth * 3 === cropPlan.outputHeight * 2,
  'Card crop plan output must use an exact 2:3 ratio.',
);
assert(
  JSON.stringify(cropPlan.cropOrder) === JSON.stringify(['left', 'top', 'right', 'bottom']),
  'Card crop plan order must remain left, top, right, bottom.',
);
assert(cropPlan.cards && typeof cropPlan.cards === 'object', 'Card crop plan cards are required.');

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
assert(
  promptCatalog.expectedCardCount === manifest.expectedCardCount,
  'Card prompt catalog expectedCardCount must match the asset manifest.',
);
assert(
  Array.isArray(promptCatalog.cardOrder) &&
    promptCatalog.cardOrder.length === manifest.expectedCardCount,
  'Card prompt catalog cardOrder must contain all 78 cards.',
);
assert(
  new Set(promptCatalog.cardOrder).size === promptCatalog.cardOrder.length,
  'Card prompt catalog cardOrder keys must be unique.',
);
assert(
  Object.keys(promptCatalog.prompts).length === manifest.expectedCardCount,
  'Card prompt catalog must contain exactly 78 prompts.',
);
for (const key of promptCatalog.cardOrder) {
  assert(
    typeof promptCatalog.prompts[key] === 'string' && promptCatalog.prompts[key].length > 0,
    `Card prompt catalog is missing ${key}.`,
  );
}
assert(
  JSON.stringify(Object.keys(cropPlan.cards)) === JSON.stringify(promptCatalog.cardOrder),
  'Card crop plan must contain all 78 cards in canonical order.',
);
for (const [key, cropEntry] of Object.entries(cropPlan.cards)) {
  assert(
    Array.isArray(cropEntry.crop) &&
      cropEntry.crop.length === 4 &&
      cropEntry.crop.every((value) => Number.isInteger(value) && value >= 0),
    `Card crop plan ${key} needs four nonnegative integer margins.`,
  );
  assert(
    ['NONE', 'LIGHT_GUTTER', 'DARK_GUTTER', 'MIXED_GUTTER'].includes(cropEntry.edgeTreatment),
    `Card crop plan ${key} has an invalid edge treatment.`,
  );
  const retainedDarkEdges = cropEntry.retainedDarkEdges ?? [];
  assert(
    Array.isArray(retainedDarkEdges) &&
      new Set(retainedDarkEdges).size === retainedDarkEdges.length &&
      retainedDarkEdges.every((side) => cropPlan.cropOrder.includes(side)),
    `Card crop plan ${key} has invalid retained dark edges.`,
  );
}

// One illustration as the app downloads it. The whole-deck budget lives in
// tools/bundle-budget/validate.mjs; this keeps a single card from silently
// regressing the payload.
const maximumShippingBytes = 640 * 1024;

const cardKeys = new Set();
const checksums = new Set();
const normalizedChecksums = new Set();
const shippingChecksums = new Set();
const manifestedPaths = new Set();
const normalizedPaths = new Set();
const shippingPaths = new Set();
const referencedPrompts = new Set();
const canonicalCardIndex = new Map(promptCatalog.cardOrder.map((key, index) => [key, index]));
let previousCanonicalIndex = -1;
let normalizedCardCount = 0;
let shippedCardCount = 0;
let shippingBytesTotal = 0;

for (const [index, card] of manifest.cards.entries()) {
  const prefix = `cards[${String(index)}]`;
  assert(typeof card.key === 'string' && card.key.length > 0, `${prefix}.key is required.`);
  assert(!cardKeys.has(card.key), `Duplicate asset manifest card key: ${card.key}.`);
  cardKeys.add(card.key);
  const cardCanonicalIndex = canonicalCardIndex.get(card.key);
  assert(cardCanonicalIndex !== undefined, `${prefix}.key is not in canonical cardOrder.`);
  assert(
    cardCanonicalIndex > previousCanonicalIndex,
    'Asset manifest cards must follow canonical cardOrder.',
  );
  previousCanonicalIndex = cardCanonicalIndex;

  assert(
    typeof card.promptKey === 'string' && card.promptKey.length > 0,
    `${prefix}.promptKey is required.`,
  );
  assert(card.promptKey === card.key, `${prefix}.promptKey must equal its canonical card key.`);
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
  assert(card.colorMode === 'RGB', `${prefix}.colorMode must be RGB.`);
  assert(dimensions.colorType === 2, `${normalizedSourcePath} PNG must use RGB color type.`);
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

  const cropEntry = cropPlan.cards[card.key];
  const expectedNormalizedPath = `tools/card-assets/normalized/${card.key}.png`;
  if (card.normalization) {
    normalizedCardCount += 1;
    assert(
      manifest.normalizationVersion === cropPlan.normalizationVersion,
      'Asset manifest normalizationVersion must match the crop plan.',
    );
    assert(
      card.normalization.version === cropPlan.normalizationVersion,
      `${prefix}.normalization.version must match the crop plan.`,
    );
    assert(
      card.normalization.sourceSha256 === card.sha256,
      `${prefix}.normalization.sourceSha256 must match the archival source.`,
    );
    const expectedCrop = Object.fromEntries(
      cropPlan.cropOrder.map((side, cropIndex) => [side, cropEntry.crop[cropIndex]]),
    );
    assert(
      JSON.stringify(card.normalization.crop) === JSON.stringify(expectedCrop),
      `${prefix}.normalization.crop must match the reviewed crop plan.`,
    );
    assert(
      card.normalization.edgeTreatment === cropEntry.edgeTreatment,
      `${prefix}.normalization.edgeTreatment must match the crop plan.`,
    );
    assert(
      normalizeRepositoryPath(card.normalization.outputPath) === expectedNormalizedPath,
      `${prefix}.normalization.outputPath must use its canonical normalized path.`,
    );
    if (!card.shipping) {
      assert(
        normalizeRepositoryPath(card.bundledPath) === expectedNormalizedPath,
        `${prefix}.bundledPath must use its normalized output until a shipping asset exists.`,
      );
    }

    const absoluteNormalizedPath = resolve(repositoryRoot, card.normalization.outputPath);
    const normalizedBuffer = await readFile(absoluteNormalizedPath);
    const normalizedStat = await stat(absoluteNormalizedPath);
    const normalizedDimensions = readPngDimensions(normalizedBuffer, expectedNormalizedPath);
    const normalizedChecksum = createHash('sha256').update(normalizedBuffer).digest('hex');
    assert(
      normalizedDimensions.width === cropPlan.outputWidth &&
        card.normalization.width === cropPlan.outputWidth,
      `${prefix}.normalization.width must match the crop plan and PNG.`,
    );
    assert(
      normalizedDimensions.height === cropPlan.outputHeight &&
        card.normalization.height === cropPlan.outputHeight,
      `${prefix}.normalization.height must match the crop plan and PNG.`,
    );
    assert(
      normalizedDimensions.colorType === 2 && card.normalization.colorMode === 'RGB',
      `${expectedNormalizedPath} must use RGB PNG encoding.`,
    );
    assert(
      normalizedStat.size === card.normalization.bytes,
      `${prefix}.normalization.bytes does not match the PNG.`,
    );
    assert(
      card.normalization.bytes <= 4_000_000,
      `${expectedNormalizedPath} exceeds the 4 MB normalized limit.`,
    );
    assert(
      normalizedChecksum === card.normalization.sha256,
      `${prefix}.normalization.sha256 does not match the PNG.`,
    );
    assert(
      !normalizedChecksums.has(normalizedChecksum),
      `Duplicate normalized asset checksum: ${normalizedChecksum}.`,
    );
    normalizedChecksums.add(normalizedChecksum);
    normalizedPaths.add(expectedNormalizedPath);

    for (const classification of ['light', 'dark']) {
      const edgeBands = card.normalization.edgeBands?.[classification];
      assert(
        edgeBands && typeof edgeBands === 'object',
        `${prefix} needs ${classification} edge data.`,
      );
      for (const side of cropPlan.cropOrder) {
        const edgeDepth = edgeBands[side];
        assert(
          Number.isInteger(edgeDepth) && edgeDepth >= 0,
          `${prefix} ${classification} ${side} edge depth must be a nonnegative integer.`,
        );
        const retainedDarkEdge =
          classification === 'dark' && (cropEntry.retainedDarkEdges ?? []).includes(side);
        assert(
          edgeDepth === 0 || retainedDarkEdge,
          `${prefix} has an unreviewed ${classification} ${side} edge band.`,
        );
        assert(
          !retainedDarkEdge || edgeDepth > 0,
          `${prefix} retained ${side} dark-edge review is stale.`,
        );
      }
    }
  } else {
    assert(
      normalizeRepositoryPath(card.bundledPath) === normalizedSourcePath,
      `${prefix}.bundledPath must remain on its source until normalization exists.`,
    );
  }

  if (card.shipping) {
    shippedCardCount += 1;
    const expectedShippingPath = `tools/card-assets/shipping/${card.key}.jpg`;
    assert(
      card.normalization,
      `${prefix} cannot ship an optimized asset without a normalized master.`,
    );
    assert(
      manifest.shippingEncodingVersion === card.shipping.encodingVersion,
      `${prefix}.shipping.encodingVersion must match the manifest encoding version.`,
    );
    assert(
      card.shipping.format === 'JPEG' && card.shipping.progressive === true,
      `${prefix}.shipping must be a progressive JPEG.`,
    );
    assert(
      Number.isInteger(card.shipping.quality) &&
        card.shipping.quality >= 80 &&
        card.shipping.quality <= 95,
      `${prefix}.shipping.quality must stay inside the reviewed 80–95 range.`,
    );
    assert(
      card.shipping.masterSha256 === card.normalization.sha256,
      `${prefix}.shipping was encoded from a stale normalized master.`,
    );
    assert(
      normalizeRepositoryPath(card.shipping.path) === expectedShippingPath,
      `${prefix}.shipping.path must use its canonical shipping path.`,
    );
    assert(
      normalizeRepositoryPath(card.bundledPath) === expectedShippingPath,
      `${prefix}.bundledPath must reference the optimized asset the app ships.`,
    );
    assert(
      card.shipping.width === cropPlan.outputWidth &&
        card.shipping.height === cropPlan.outputHeight,
      `${prefix}.shipping dimensions must match the crop plan.`,
    );

    const absoluteShippingPath = resolve(repositoryRoot, card.shipping.path);
    const shippingBuffer = await readFile(absoluteShippingPath);
    const shippingStat = await stat(absoluteShippingPath);
    assert(
      shippingBuffer.subarray(0, 3).toString('hex') === 'ffd8ff',
      `${expectedShippingPath} is not a JPEG file.`,
    );
    assert(
      shippingStat.size === card.shipping.bytes,
      `${prefix}.shipping.bytes does not match the file.`,
    );
    assert(
      card.shipping.bytes <= maximumShippingBytes,
      `${expectedShippingPath} exceeds the ${String(maximumShippingBytes / 1024)} KiB shipping budget.`,
    );
    const shippingChecksum = createHash('sha256').update(shippingBuffer).digest('hex');
    assert(
      shippingChecksum === card.shipping.sha256,
      `${prefix}.shipping.sha256 does not match the file.`,
    );
    assert(
      !shippingChecksums.has(shippingChecksum),
      `Duplicate shipping asset checksum: ${shippingChecksum}.`,
    );
    shippingChecksums.add(shippingChecksum);
    shippingPaths.add(expectedShippingPath);
    shippingBytesTotal += card.shipping.bytes;
  }

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

const normalizedDirectory = resolve(toolsDirectory, 'normalized');
let normalizedFiles = [];
try {
  normalizedFiles = (await readdir(normalizedDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.toLocaleLowerCase('en').endsWith('.png'))
    .map((entry) =>
      normalizeRepositoryPath(relative(repositoryRoot, resolve(normalizedDirectory, entry.name))),
    );
} catch (error) {
  if (error.code !== 'ENOENT') {
    throw error;
  }
}
for (const normalizedPath of normalizedFiles) {
  assert(
    normalizedPaths.has(normalizedPath),
    `Normalized PNG lacks a manifest entry: ${normalizedPath}.`,
  );
}
assert(
  normalizedFiles.length === normalizedCardCount,
  'Normalized PNG count must match normalized manifest entries.',
);

const shippingDirectory = resolve(toolsDirectory, 'shipping');
let shippingFiles = [];
try {
  shippingFiles = (await readdir(shippingDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.toLocaleLowerCase('en').endsWith('.jpg'))
    .map((entry) =>
      normalizeRepositoryPath(relative(repositoryRoot, resolve(shippingDirectory, entry.name))),
    );
} catch (error) {
  if (error.code !== 'ENOENT') {
    throw error;
  }
}
for (const shippingPath of shippingFiles) {
  assert(shippingPaths.has(shippingPath), `Shipping JPEG lacks a manifest entry: ${shippingPath}.`);
}
assert(
  shippingFiles.length === shippedCardCount,
  'Shipping JPEG count must match shipping manifest entries.',
);
if (shippedCardCount > 0) {
  assert(
    shippedCardCount === normalizedCardCount,
    'Every normalized master must have an optimized shipping asset before release.',
  );
}

const generationStatus =
  cardKeys.size === manifest.expectedCardCount
    ? 'full deck complete'
    : 'remaining prompts are planned';

const shippingSummary =
  shippedCardCount === 0
    ? 'no optimized shipping assets yet'
    : `${String(shippedCardCount)}/${String(manifest.expectedCardCount)} shipping assets at ${(shippingBytesTotal / 1_048_576).toFixed(1)} MiB`;

process.stdout.write(
  `Card asset manifest is valid (${String(cardKeys.size)}/${String(manifest.expectedCardCount)} full-deck sources generated; ${String(normalizedCardCount)}/${String(manifest.expectedCardCount)} normalized; ${shippingSummary}; ${generationStatus}).\n`,
);
