import { readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Shipping-payload gate for the full 78-card deck (spec section 12 risk
 * "Full deck increases app size/memory" and Phase 11's bundle-size
 * confirmation). Card art is statically imported by the app, so every
 * normalized illustration is downloaded by every player.
 *
 * The budgets are deliberately strict: iOS warns players before a large
 * cellular download, and a first launch that decodes oversized images on the
 * oldest supported device is the exact failure this gate exists to prevent.
 */
export const bundleBudgets = {
  /** One illustration, as stored in the app bundle. */
  illustrationBytes: 640 * 1024,
  /** All 78 illustrations together. */
  illustrationPayloadBytes: 32 * 1024 * 1024,
  /** Bounded decode size: width x height x 4 bytes for one RGBA surface. */
  decodedIllustrationBytes: 5 * 1024 * 1024,
  /** Whole exported iOS bundle, checked only when `expo export` has run. */
  exportedBundleBytes: 64 * 1024 * 1024,
};

const toolsDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(toolsDirectory, '..', '..');

function formatMebibytes(bytes) {
  return `${(bytes / 1_048_576).toFixed(1)} MiB`;
}

async function directorySize(path) {
  const { readdir } = await import('node:fs/promises');
  let total = 0;
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    const entryPath = resolve(path, entry.name);
    if (entry.isDirectory()) {
      total += (await directorySize(entryPath)) ?? 0;
    } else if (entry.isFile()) {
      total += (await stat(entryPath)).size;
    }
  }
  return total;
}

export async function measureShippingPayload() {
  const manifest = JSON.parse(
    await readFile(resolve(repositoryRoot, 'tools/card-assets/manifest.json'), 'utf8'),
  );

  const illustrations = [];
  for (const card of manifest.cards) {
    const path = resolve(repositoryRoot, card.shipping?.path ?? card.bundledPath);
    const { size } = await stat(path);
    illustrations.push({
      bytes: size,
      decodedBytes: card.width * card.height * 4,
      key: card.key,
    });
  }

  const payloadBytes = illustrations.reduce((total, card) => total + card.bytes, 0);
  return {
    exportedBundleBytes: await directorySize(resolve(repositoryRoot, 'apps/mobile/dist')),
    illustrations,
    payloadBytes,
  };
}

export function evaluateBudgets(measurement) {
  const violations = [];
  const oversized = measurement.illustrations.filter(
    (card) => card.bytes > bundleBudgets.illustrationBytes,
  );
  const overDecoded = measurement.illustrations.filter(
    (card) => card.decodedBytes > bundleBudgets.decodedIllustrationBytes,
  );

  if (measurement.payloadBytes > bundleBudgets.illustrationPayloadBytes) {
    violations.push(
      `Card art payload is ${formatMebibytes(measurement.payloadBytes)}; the budget is ${formatMebibytes(bundleBudgets.illustrationPayloadBytes)}.`,
    );
  }
  if (oversized.length > 0) {
    const largest = [...oversized].sort((left, right) => right.bytes - left.bytes)[0];
    violations.push(
      `${String(oversized.length)} illustrations exceed ${formatMebibytes(bundleBudgets.illustrationBytes)} each; the largest is ${largest.key} at ${formatMebibytes(largest.bytes)}.`,
    );
  }
  if (overDecoded.length > 0) {
    violations.push(
      `${String(overDecoded.length)} illustrations decode above ${formatMebibytes(bundleBudgets.decodedIllustrationBytes)} of RGBA memory.`,
    );
  }
  if (
    measurement.exportedBundleBytes !== null &&
    measurement.exportedBundleBytes > bundleBudgets.exportedBundleBytes
  ) {
    violations.push(
      `The exported iOS bundle is ${formatMebibytes(measurement.exportedBundleBytes)}; the budget is ${formatMebibytes(bundleBudgets.exportedBundleBytes)}.`,
    );
  }
  return violations;
}

const measurement = await measureShippingPayload();
const violations = evaluateBudgets(measurement);
const meanBytes = measurement.payloadBytes / measurement.illustrations.length;
const worstDecode = Math.max(...measurement.illustrations.map((card) => card.decodedBytes));

const report = [
  `Card illustrations: ${String(measurement.illustrations.length)}`,
  `Bundled art payload: ${formatMebibytes(measurement.payloadBytes)} (budget ${formatMebibytes(bundleBudgets.illustrationPayloadBytes)})`,
  `Mean illustration: ${formatMebibytes(meanBytes)} (budget ${formatMebibytes(bundleBudgets.illustrationBytes)} each)`,
  `Largest decode: ${formatMebibytes(worstDecode)} (budget ${formatMebibytes(bundleBudgets.decodedIllustrationBytes)})`,
  measurement.exportedBundleBytes === null
    ? 'Exported iOS bundle: not built; run the mobile build to measure it.'
    : `Exported iOS bundle: ${formatMebibytes(measurement.exportedBundleBytes)} (budget ${formatMebibytes(bundleBudgets.exportedBundleBytes)})`,
].join('\n');

if (violations.length > 0) {
  process.stderr.write(
    `${report}\n\nShipping payload budget exceeded:\n- ${violations.join('\n- ')}\n`,
  );
  process.exit(1);
}

process.stdout.write(`${report}\nShipping payload is inside every budget.\n`);
