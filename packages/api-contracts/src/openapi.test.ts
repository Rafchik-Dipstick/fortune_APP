import { describe, expect, it } from 'vitest';

import { apiPaths, healthResponseSchema, stableApiErrorCodes } from './index.js';
import { generateOpenApiDocument } from './openapi.js';

describe('generated OpenAPI document', () => {
  it('uses the shared path and response schemas for health', () => {
    const document = generateOpenApiDocument();
    const healthOperation = document.paths?.[apiPaths.health]?.get;

    expect(Object.keys(document.paths ?? {})).toEqual([
      apiPaths.health,
      apiPaths.authGameCenter,
      apiPaths.authRefresh,
      apiPaths.authLogout,
      apiPaths.me,
    ]);
    expect(healthOperation?.responses).toHaveProperty('200');
    expect(healthOperation?.responses).toHaveProperty('503');
    expect(document.components?.schemas).toHaveProperty('HealthResponse');
    expect(document.components?.schemas).toHaveProperty('ApiErrorEnvelope');
  });

  it('publishes strict authentication request and response schemas', () => {
    const document = generateOpenApiDocument();

    expect(document.paths?.[apiPaths.authGameCenter]?.post?.responses).toHaveProperty('200');
    expect(document.paths?.[apiPaths.authRefresh]?.post?.parameters).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'Idempotency-Key', in: 'header' })]),
    );
    expect(document.paths?.[apiPaths.authLogout]?.post?.security).toEqual([{ bearerAuth: [] }]);
    expect(document.components?.securitySchemes).toHaveProperty('bearerAuth');
    expect(document.components?.schemas).toHaveProperty('GameCenterAuthRequest');
    expect(document.components?.schemas).toHaveProperty('SessionTokens');
  });

  it('publishes every canonical server error code exactly once', () => {
    const document = generateOpenApiDocument();

    expect(document['x-stable-error-codes']).toEqual(stableApiErrorCodes);
    expect(new Set(document['x-stable-error-codes']).size).toBe(stableApiErrorCodes.length);
  });

  it('keeps documented health examples representable by the runtime schema', () => {
    expect(
      healthResponseSchema.parse({
        checks: { database: 'ready', process: 'ready' },
        status: 'ready',
      }),
    ).toBeDefined();
  });
});
