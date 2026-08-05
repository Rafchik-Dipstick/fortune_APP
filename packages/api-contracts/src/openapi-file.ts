import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { format, resolveConfig } from 'prettier';

import { generateOpenApiDocument } from './openapi.js';

const canonicalPath = fileURLToPath(
  new URL('../openapi/fortuneness-v1.openapi.json', import.meta.url),
);
const prettierConfig = await resolveConfig(canonicalPath);
const renderedDocument = await format(JSON.stringify(generateOpenApiDocument()), {
  ...prettierConfig,
  filepath: canonicalPath,
  parser: 'json',
});
const mode = process.argv[2];

if (mode === '--write') {
  await mkdir(dirname(canonicalPath), { recursive: true });
  await writeFile(canonicalPath, renderedDocument, 'utf8');
} else if (mode === '--check') {
  const canonicalDocument = await readFile(canonicalPath, 'utf8');
  if (canonicalDocument !== renderedDocument) {
    process.stderr.write(
      'OpenAPI drift detected. Run `corepack npm run openapi:generate` and commit the result.\n',
    );
    process.exitCode = 1;
  }
} else {
  process.stderr.write('Expected --write or --check.\n');
  process.exitCode = 1;
}
