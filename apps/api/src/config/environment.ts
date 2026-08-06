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

const productIdentifierSchema = z
  .string()
  .trim()
  .min(3)
  .max(160)
  .regex(/^[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)+$/u);

const optionalTrimmedSchema = (maximumLength: number) =>
  z
    .string()
    .trim()
    .max(maximumLength)
    .default('')
    .transform((value) => (value.length === 0 ? null : value));

const environmentBoolean = (defaultValue: boolean) =>
  z.preprocess((value) => {
    if (value === undefined || value === '') {
      return defaultValue;
    }
    if (value === 'true') {
      return true;
    }
    if (value === 'false') {
      return false;
    }
    return value;
  }, z.boolean());

const base64Pkcs8KeySchema = z
  .string()
  .trim()
  .min(1)
  .refine(
    (value) => {
      const decoded = Buffer.from(value, 'base64');
      return (
        decoded.length > 0 &&
        decoded.toString('base64') === value.replace(/\s+/gu, '') &&
        decoded.toString('utf8').includes('PRIVATE KEY')
      );
    },
    { message: 'must be canonical base64 for a PEM private key' },
  )
  .transform((value) => Buffer.from(value, 'base64').toString('utf8'));

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
    APP_APPLE_ID: z
      .string()
      .trim()
      .regex(/^\d*$/u, { message: 'must be the numeric App Apple ID' })
      .default('')
      .transform((value) => (value.length === 0 ? null : Number(value))),
    APPLE_IAP_ISSUER_ID: optionalTrimmedSchema(64),
    APPLE_IAP_KEY_ID: optionalTrimmedSchema(32),
    APPLE_IAP_PRIVATE_KEY_BASE64: base64Pkcs8KeySchema.optional(),
    APPLE_IAP_ENVIRONMENT: z.enum(['SANDBOX', 'PRODUCTION', 'XCODE']).default('SANDBOX'),
    APP_STORE_NOTIFICATION_ENCRYPTION_KEYS_JSON: keyRingSchema,
    APP_STORE_NOTIFICATION_CURRENT_KEY_VERSION: keyVersionSchema,
    APP_STORE_NOTIFICATION_RAW_TTL_DAYS: environmentInteger(90, 1, 365),
    APPLE_CONSUMPTION_INFO_ENABLED: environmentBoolean(false),
    IAP_FORTUNE_PACK_10_PRODUCT_ID: productIdentifierSchema.default(
      'app.fortuneness.fortunepack10',
    ),
    IAP_ORACLE_PLUS_MONTHLY_PRODUCT_ID: productIdentifierSchema.default(
      'app.fortuneness.oracleplus.monthly',
    ),
    IAP_ORACLE_PLUS_MONTHLY_EXPECTED_BILLING_PLAN_TYPE: optionalTrimmedSchema(64),
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
      ['APP_STORE_NOTIFICATION_ENCRYPTION_KEYS_JSON', 'APP_STORE_NOTIFICATION_CURRENT_KEY_VERSION'],
    ] as const) {
      // Own-property check: a version like "constructor" must not pass by
      // resolving to an inherited Object.prototype member.
      if (!Object.hasOwn(environment[keysField], environment[versionField])) {
        context.addIssue({
          code: 'custom',
          path: [versionField],
          message: `must name a key present in ${keysField}`,
        });
      }
    }

    const appStoreCredentialFields = [
      'APPLE_IAP_ISSUER_ID',
      'APPLE_IAP_KEY_ID',
      'APPLE_IAP_PRIVATE_KEY_BASE64',
    ] as const;
    const presentCredentials = appStoreCredentialFields.filter(
      (field) => environment[field] !== null && environment[field] !== undefined,
    );
    if (presentCredentials.length !== 0 && presentCredentials.length !== 3) {
      for (const field of appStoreCredentialFields) {
        if (environment[field] === null || environment[field] === undefined) {
          context.addIssue({
            code: 'custom',
            path: [field],
            message: 'App Store Server API credentials must be configured together',
          });
        }
      }
    }

    if (environment.NODE_ENV === 'production') {
      if (environment.APPLE_IAP_ENVIRONMENT === 'XCODE') {
        context.addIssue({
          code: 'custom',
          path: ['APPLE_IAP_ENVIRONMENT'],
          message: 'the Xcode StoreKit test environment is local-only',
        });
      }
      if (presentCredentials.length !== 3) {
        context.addIssue({
          code: 'custom',
          path: ['APPLE_IAP_ISSUER_ID'],
          message: 'App Store Server API credentials are required in production',
        });
      }
    }

    if (
      environment.IAP_FORTUNE_PACK_10_PRODUCT_ID === environment.IAP_ORACLE_PLUS_MONTHLY_PRODUCT_ID
    ) {
      context.addIssue({
        code: 'custom',
        path: ['IAP_ORACLE_PLUS_MONTHLY_PRODUCT_ID'],
        message: 'commerce product identifiers must be distinct',
      });
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

export interface AppStoreServerApiCredentials {
  issuerId: string;
  keyId: string;
  privateKeyPem: string;
}

export interface CommerceEnvironment {
  appAppleId: number | null;
  appStoreServerApi: AppStoreServerApiCredentials | null;
  consumptionInfoEnabled: boolean;
  environment: 'SANDBOX' | 'PRODUCTION' | 'XCODE';
  expectedSubscriptionBillingPlanType: string | null;
  fortunePack10ProductId: string;
  notificationEncryptionKeys: VersionedKeyRing;
  notificationRawTtlDays: number;
  oraclePlusMonthlyProductId: string;
}

export interface ApiEnvironment {
  archive: ArchiveEnvironment;
  authentication: AuthenticationEnvironment;
  commerce: CommerceEnvironment;
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
    commerce: {
      appAppleId: result.data.APP_APPLE_ID,
      appStoreServerApi:
        result.data.APPLE_IAP_ISSUER_ID !== null &&
        result.data.APPLE_IAP_KEY_ID !== null &&
        result.data.APPLE_IAP_PRIVATE_KEY_BASE64 !== undefined
          ? {
              issuerId: result.data.APPLE_IAP_ISSUER_ID,
              keyId: result.data.APPLE_IAP_KEY_ID,
              privateKeyPem: result.data.APPLE_IAP_PRIVATE_KEY_BASE64,
            }
          : null,
      consumptionInfoEnabled: result.data.APPLE_CONSUMPTION_INFO_ENABLED,
      environment: result.data.APPLE_IAP_ENVIRONMENT,
      expectedSubscriptionBillingPlanType:
        result.data.IAP_ORACLE_PLUS_MONTHLY_EXPECTED_BILLING_PLAN_TYPE,
      fortunePack10ProductId: result.data.IAP_FORTUNE_PACK_10_PRODUCT_ID,
      notificationEncryptionKeys: {
        currentVersion: result.data.APP_STORE_NOTIFICATION_CURRENT_KEY_VERSION,
        keys: result.data.APP_STORE_NOTIFICATION_ENCRYPTION_KEYS_JSON,
      },
      notificationRawTtlDays: result.data.APP_STORE_NOTIFICATION_RAW_TTL_DAYS,
      oraclePlusMonthlyProductId: result.data.IAP_ORACLE_PLUS_MONTHLY_PRODUCT_ID,
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
