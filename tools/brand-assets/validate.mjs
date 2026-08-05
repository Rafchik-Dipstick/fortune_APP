import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const toolsDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(toolsDirectory, '..', '..');
const manifest = JSON.parse(await readFile(new URL('./manifest.json', import.meta.url), 'utf8'));

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function normalizeRepositoryPath(path) {
  return path.replaceAll('\\', '/');
}

function readPngDimensions(buffer, path) {
  assert(
    buffer.subarray(0, 8).toString('hex') === '89504e470d0a1a0a',
    `${path} is not a PNG file.`,
  );
  assert(buffer.subarray(12, 16).toString('ascii') === 'IHDR', `${path} has no PNG IHDR.`);

  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    colorType: buffer.readUInt8(25),
  };
}

assert(manifest.schemaVersion === 1, 'Brand manifest schemaVersion must be 1.');
assert(
  typeof manifest.promptTemplateVersion === 'string' && manifest.promptTemplateVersion.length > 0,
  'Brand manifest needs a promptTemplateVersion.',
);
assert(Array.isArray(manifest.assets) && manifest.assets.length > 0, 'Brand assets are required.');

const keys = new Set();
const checksums = new Set();
const manifestedPaths = new Set();

for (const [index, asset] of manifest.assets.entries()) {
  const prefix = `assets[${String(index)}]`;
  assert(typeof asset.key === 'string' && asset.key.length > 0, `${prefix}.key is required.`);
  assert(!keys.has(asset.key), `Duplicate brand asset key: ${asset.key}.`);
  keys.add(asset.key);
  assert(Array.isArray(asset.roles) && asset.roles.length > 0, `${prefix}.roles are required.`);
  assert(new Set(asset.roles).size === asset.roles.length, `${prefix}.roles must be unique.`);
  assert(
    asset.roles.every((role) => ['APP_ICON_CANDIDATE', 'SPLASH_MARK_CANDIDATE'].includes(role)),
    `${prefix}.roles contain an unsupported value.`,
  );
  assert(
    typeof asset.sourceOutputPath === 'string' && asset.sourceOutputPath.length > 0,
    `${prefix}.sourceOutputPath is required.`,
  );

  const normalizedPath = normalizeRepositoryPath(asset.sourceOutputPath);
  assert(
    !normalizedPath.startsWith('../') && !normalizedPath.startsWith('/'),
    `${prefix}.sourceOutputPath must stay inside the repository.`,
  );
  manifestedPaths.add(normalizedPath);

  const absolutePath = resolve(repositoryRoot, asset.sourceOutputPath);
  const buffer = await readFile(absolutePath);
  const fileStat = await stat(absolutePath);
  const dimensions = readPngDimensions(buffer, normalizedPath);
  const checksum = createHash('sha256').update(buffer).digest('hex');

  assert(dimensions.width === asset.width, `${prefix}.width does not match the PNG.`);
  assert(dimensions.height === asset.height, `${prefix}.height does not match the PNG.`);
  assert(dimensions.width === dimensions.height, `${normalizedPath} must be square.`);
  assert(dimensions.width >= 1024, `${normalizedPath} must be at least 1024 × 1024.`);
  assert(asset.colorMode === 'RGB' && dimensions.colorType === 2, `${normalizedPath} must be RGB.`);
  assert(fileStat.size === asset.bytes, `${prefix}.bytes does not match the PNG.`);
  assert(asset.bytes <= 2_000_000, `${normalizedPath} exceeds the 2 MB brand proof limit.`);
  assert(checksum === asset.sha256, `${prefix}.sha256 does not match the PNG.`);
  assert(/^[a-f0-9]{64}$/u.test(asset.sha256), `${prefix}.sha256 must be lowercase SHA-256.`);
  assert(!checksums.has(checksum), `Duplicate brand checksum: ${checksum}.`);
  checksums.add(checksum);
  assert(
    ['GENERATED_UNREVIEWED', 'READY_FOR_REVIEW', 'APPROVED'].includes(asset.reviewStatus),
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
    `Generated brand PNG is unmanifested: ${generatedPath}.`,
  );
}

process.stdout.write(`Brand asset manifest is valid (${String(keys.size)} proof recorded).\n`);
