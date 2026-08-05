import { z } from 'zod';

const nodeEnvironments = ['development', 'test', 'production'] as const;
const logLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

const environmentInteger = (defaultValue: number, minimum: number, maximum: number) =>
  z.preprocess((value) => {
    if (value === undefined) {
      return defaultValue;
    }

    if (typeof value === 'string' && /^\d+$/.test(value)) {
      return Number(value);
    }

    return value;
  }, z.number().int().min(minimum).max(maximum));

const databaseUrlSchema = z
  .string()
  .min(1)
  .refine(
    (value) => {
      try {
        const url = new URL(value);
        return url.protocol === 'postgresql:' || url.protocol === 'postgres:';
      } catch {
        return false;
      }
    },
    { message: 'must be a PostgreSQL connection URL' },
  );

const corsOriginsSchema = z
  .string()
  .default('')
  .transform((rawOrigins, context): string[] => {
    const normalizedOrigins: string[] = [];

    for (const candidate of rawOrigins.split(',').map((origin) => origin.trim())) {
      if (candidate.length === 0) {
        continue;
      }

      try {
        const url = new URL(candidate);
        const isHttpOrigin = url.protocol === 'http:' || url.protocol === 'https:';
        const hasOnlyOriginParts =
          url.pathname === '/' && url.search.length === 0 && url.hash.length === 0;

        if (!isHttpOrigin || !hasOnlyOriginParts || url.origin === 'null') {
          throw new Error('Not an HTTP origin');
        }

        if (!normalizedOrigins.includes(url.origin)) {
          normalizedOrigins.push(url.origin);
        }
      } catch {
        context.addIssue({
          code: 'custom',
          message: 'must contain only comma-separated HTTP(S) origins without paths',
        });
        return z.NEVER;
      }
    }

    return normalizedOrigins;
  });

const rawApiEnvironmentSchema = z
  .object({
    NODE_ENV: z.enum(nodeEnvironments).default('development'),
    PORT: environmentInteger(3000, 1, 65_535),
    DATABASE_URL: databaseUrlSchema,
    TRUST_PROXY: environmentInteger(0, 0, 10),
    CORS_ORIGINS: corsOriginsSchema,
    LOG_LEVEL: z.enum(logLevels).default('info'),
  })
  .superRefine((environment, context) => {
    if (environment.NODE_ENV === 'production' && environment.TRUST_PROXY === 0) {
      context.addIssue({
        code: 'custom',
        path: ['TRUST_PROXY'],
        message: 'must be an explicitly tested positive hop count in production',
      });
    }

    if (
      environment.NODE_ENV === 'production' &&
      environment.CORS_ORIGINS.some((origin) => !origin.startsWith('https://'))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['CORS_ORIGINS'],
        message: 'must contain only HTTPS origins in production',
      });
    }
  });

export interface ApiEnvironment {
  corsOrigins: string[];
  databaseUrl: string;
  logLevel: (typeof logLevels)[number];
  nodeEnvironment: (typeof nodeEnvironments)[number];
  port: number;
  trustProxyHops: number;
}

export class InvalidApiEnvironmentError extends Error {
  readonly issues: readonly z.core.$ZodIssue[];

  constructor(issues: readonly z.core.$ZodIssue[]) {
    const summary = issues
      .map((issue) => `${issue.path.join('.') || 'environment'}: ${issue.message}`)
      .join('; ');

    super(`Invalid API environment: ${summary}`);
    this.name = 'InvalidApiEnvironmentError';
    this.issues = issues;
  }
}

export const parseApiEnvironment = (source: NodeJS.ProcessEnv): ApiEnvironment => {
  const result = rawApiEnvironmentSchema.safeParse(source);

  if (!result.success) {
    throw new InvalidApiEnvironmentError(result.error.issues);
  }

  return {
    corsOrigins: result.data.CORS_ORIGINS,
    databaseUrl: result.data.DATABASE_URL,
    logLevel: result.data.LOG_LEVEL,
    nodeEnvironment: result.data.NODE_ENV,
    port: result.data.PORT,
    trustProxyHops: result.data.TRUST_PROXY,
  };
};
