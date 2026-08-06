import 'dotenv/config';

import { defineConfig } from 'prisma/config';

const schemaOnlyFallbackUrl = 'postgresql://invalid:invalid@127.0.0.1:1/fortuneness_schema_only';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // Schema generation/validation does not connect. Any database command without
    // an explicit environment URL fails against the reserved local port instead.
    url: process.env.DATABASE_URL ?? schemaOnlyFallbackUrl,
  },
});
