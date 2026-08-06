import { z } from 'zod';

const nodeEnvironments = ['development', 'test', 'production'] as const;
const logLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
const keyVersionSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/u);

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

const hostAllowlistSchema = z.string().transform((rawHosts, context): string[] => {
  const hosts: string[] = [];
  for (const candidate of rawHosts.split(',').map((host) => host.trim().toLowerCase())) {
    if (candidate.length === 0) {
      continue;
    }
    if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/u.test(candidate)) {
      context.addIssue({ code: 'custom', message: 'must contain only DNS hostnames' });
      return z.NEVER;
    }
    if (!hosts.includes(candidate)) {
      hosts.push(candidate);
    }
  }
  if (hosts.length === 0) {
    context.addIssue({ code: 'custom', message: 'must contain at least one DNS hostname' });
    return z.NEVER;
  }
  return hosts;
});

const keyRingSchema = z.string().transform((rawValue, context): Record<string, Buffer> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    context.addIssue({ code: 'custom', message: 'must be a JSON object of base64 keys' });
    return z.NEVER;
  }

  const recordResult = z.record(keyVersionSchema, z.string()).safeParse(parsed);
  if (!recordResult.success || Object.keys(recordResult.data).length === 0) {
    context.addIssue({
      code: 'custom',
      message: 'must contain at least one versioned base64 key',
    });
    return z.NEVER;
  }

  const keys: Record<string, Buffer> = {};
  for (const [version, encodedKey] of Object.entries(recordResult.data)) {
    const decodedKey = Buffer.from(encodedKey, 'base64');
    if (decodedKey.length !== 32 || decodedKey.toString('base64') !== encodedKey) {
      context.addIssue({
        code: 'custom',
        message: `key ${version} must be canonical base64 for exactly 32 bytes`,
      });
      return z.NEVER;
    }
    keys[version] = decodedKey;
  }
  return keys;
});

const bundleIdentifierSchema = z
  .string()
  .trim()
  .min(3)
  .max(255)
  .regex(/^[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)+$/u);

const rawApiEnvironmentSchema = z
  .object({
    NODE_ENV: z.enum(nodeEnvironments).default('development'),
    PORT: environmentInteger(3000, 1, 65_535),
    DATABASE_URL: databaseUrlSchema,
    TRUST_PROXY: environmentInteger(0, 0, 10),
    CORS_ORIGINS: corsOriginsSchema,
    LOG_LEVEL: z.enum(logLevels).default('info'),
    APP_BUNDLE_ID: bundleIdentifierSchema,
    GAME_CENTER_ALLOWED_PUBLIC_KEY_HOSTS: hostAllowlistSchema.default(['static.gc.apple.com']),
    GAME_CENTER_ALLOWED_CERTIFICATE_HOSTS: hostAllowlistSchema.default(['cacerts.digicert.com']),
    GAME_CENTER_IDENTITY_HMAC_KEYS_JSON: keyRingSchema,
    GAME_CENTER_IDENTITY_CURRENT_KEY_VERSION: keyVersionSchema,
    GAME_CENTER_PROOF_MAX_AGE_SECONDS: environmentInteger(300, 30, 900),
    GAME_CENTER_PROOF_CLOCK_SKEW_SECONDS: environmentInteger(60, 0, 300),
    JWT_ACCESS_KEYS_JSON: keyRingSchema,
    JWT_ACCESS_CURRENT_KEY_VERSION: keyVersionSchema,
    JWT_ISSUER: z.string().trim().min(3).max(128),
    JWT_AUDIENCE: z.string().trim().min(3).max(128),
    JWT_ACCESS_TTL_SECONDS: environmentInteger(900, 60, 3_600),
    REFRESH_TOKEN_HMAC_KEYS_JSON: keyRingSchema,
    REFRESH_TOKEN_CURRENT_KEY_VERSION: keyVersionSchema,
    REFRESH_TOKEN_TTL_DAYS: environmentInteger(30, 1, 90),
    REFRESH_REPLAY_ENCRYPTION_KEYS_JSON: keyRingSchema,
    REFRESH_REPLAY_CURRENT_KEY_VERSION: keyVersionSchema,
    APP_ACCOUNT_TOKEN_HMAC_KEYS_JSON: keyRingSchema,
    APP_ACCOUNT_TOKEN_HMAC_CURRENT_KEY_VERSION: keyVersionSchema,
    APP_ACCOUNT_TOKEN_ENCRYPTION_KEYS_JSON: keyRingSchema,
    APP_ACCOUNT_TOKEN_ENCRYPTION_CURRENT_KEY_VERSION: keyVersionSchema,
    HISTORY_CURSOR_HMAC_KEYS_JSON: keyRingSchema,
    HISTORY_CURSOR_CURRENT_KEY_VERSION: keyVersionSchema,
    ACCOUNT_DELETION_REAUTH_MAX_AGE_SECONDS: environmentInteger(300, 60, 900),
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

    for (const [keysField, versionField] of [
      ['GAME_CENTER_IDENTITY_HMAC_KEYS_JSON', 'GAME_CENTER_IDENTITY_CURRENT_KEY_VERSION'],
      ['JWT_ACCESS_KEYS_JSON', 'JWT_ACCESS_CURRENT_KEY_VERSION'],
      ['REFRESH_TOKEN_HMAC_KEYS_JSON', 'REFRESH_TOKEN_CURRENT_KEY_VERSION'],
      ['REFRESH_REPLAY_ENCRYPTION_KEYS_JSON', 'REFRESH_REPLAY_CURRENT_KEY_VERSION'],
      ['APP_ACCOUNT_TOKEN_HMAC_KEYS_JSON', 'APP_ACCOUNT_TOKEN_HMAC_CURRENT_KEY_VERSION'],
      [
        'APP_ACCOUNT_TOKEN_ENCRYPTION_KEYS_JSON',
        'APP_ACCOUNT_TOKEN_ENCRYPTION_CURRENT_KEY_VERSION',
      ],
      ['HISTORY_CURSOR_HMAC_KEYS_JSON', 'HISTORY_CURSOR_CURRENT_KEY_VERSION'],
    ] as const) {
      if (environment[keysField][environment[versionField]] === undefined) {
        context.addIssue({
          code: 'custom',
          path: [versionField],
          message: `must name a key present in ${keysField}`,
        });
      }
    }
  });

export interface VersionedKeyRing {
  currentVersion: string;
  keys: Readonly<Record<string, Buffer>>;
}

export interface AuthenticationEnvironment {
  accountDeletionReauthMaxAgeSeconds: number;
  appAccountTokenEncryptionKeys: VersionedKeyRing;
  appAccountTokenHmacKeys: VersionedKeyRing;
  bundleId: string;
  gameCenterCertificateHosts: string[];
  gameCenterIdentityKeys: VersionedKeyRing;
  gameCenterProofClockSkewSeconds: number;
  gameCenterProofMaxAgeSeconds: number;
  gameCenterPublicKeyHosts: string[];
  jwtAccessKeys: VersionedKeyRing;
  jwtAccessTtlSeconds: number;
  jwtAudience: string;
  jwtIssuer: string;
  refreshReplayEncryptionKeys: VersionedKeyRing;
  refreshTokenHmacKeys: VersionedKeyRing;
  refreshTokenTtlDays: number;
}

export interface ArchiveEnvironment {
  historyCursorHmacKeys: VersionedKeyRing;
}

export interface ApiEnvironment {
  archive: ArchiveEnvironment;
  authentication: AuthenticationEnvironment;
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
    archive: {
      historyCursorHmacKeys: {
        currentVersion: result.data.HISTORY_CURSOR_CURRENT_KEY_VERSION,
        keys: result.data.HISTORY_CURSOR_HMAC_KEYS_JSON,
      },
    },
    authentication: {
      accountDeletionReauthMaxAgeSeconds: result.data.ACCOUNT_DELETION_REAUTH_MAX_AGE_SECONDS,
      appAccountTokenEncryptionKeys: {
        currentVersion: result.data.APP_ACCOUNT_TOKEN_ENCRYPTION_CURRENT_KEY_VERSION,
        keys: result.data.APP_ACCOUNT_TOKEN_ENCRYPTION_KEYS_JSON,
      },
      appAccountTokenHmacKeys: {
        currentVersion: result.data.APP_ACCOUNT_TOKEN_HMAC_CURRENT_KEY_VERSION,
        keys: result.data.APP_ACCOUNT_TOKEN_HMAC_KEYS_JSON,
      },
      bundleId: result.data.APP_BUNDLE_ID,
      gameCenterCertificateHosts: result.data.GAME_CENTER_ALLOWED_CERTIFICATE_HOSTS,
      gameCenterIdentityKeys: {
        currentVersion: result.data.GAME_CENTER_IDENTITY_CURRENT_KEY_VERSION,
        keys: result.data.GAME_CENTER_IDENTITY_HMAC_KEYS_JSON,
      },
      gameCenterProofClockSkewSeconds: result.data.GAME_CENTER_PROOF_CLOCK_SKEW_SECONDS,
      gameCenterProofMaxAgeSeconds: result.data.GAME_CENTER_PROOF_MAX_AGE_SECONDS,
      gameCenterPublicKeyHosts: result.data.GAME_CENTER_ALLOWED_PUBLIC_KEY_HOSTS,
      jwtAccessKeys: {
        currentVersion: result.data.JWT_ACCESS_CURRENT_KEY_VERSION,
        keys: result.data.JWT_ACCESS_KEYS_JSON,
      },
      jwtAccessTtlSeconds: result.data.JWT_ACCESS_TTL_SECONDS,
      jwtAudience: result.data.JWT_AUDIENCE,
      jwtIssuer: result.data.JWT_ISSUER,
      refreshReplayEncryptionKeys: {
        currentVersion: result.data.REFRESH_REPLAY_CURRENT_KEY_VERSION,
        keys: result.data.REFRESH_REPLAY_ENCRYPTION_KEYS_JSON,
      },
      refreshTokenHmacKeys: {
        currentVersion: result.data.REFRESH_TOKEN_CURRENT_KEY_VERSION,
        keys: result.data.REFRESH_TOKEN_HMAC_KEYS_JSON,
      },
      refreshTokenTtlDays: result.data.REFRESH_TOKEN_TTL_DAYS,
    },
    corsOrigins: result.data.CORS_ORIGINS,
    databaseUrl: result.data.DATABASE_URL,
    logLevel: result.data.LOG_LEVEL,
    nodeEnvironment: result.data.NODE_ENV,
    port: result.data.PORT,
    trustProxyHops: result.data.TRUST_PROXY,
  };
};
