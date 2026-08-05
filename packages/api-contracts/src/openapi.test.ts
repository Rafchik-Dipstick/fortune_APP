import { describe, expect, it } from 'vitest';

import { apiPaths, healthResponseSchema, stableApiErrorCodes } from './index.js';
import { generateOpenApiDocument } from './openapi.js';

describe('generated OpenAPI document', () => {
  it('uses the shared path and response schemas for health', () => {
    const document = generateOpenApiDocument();
    const healthOperation = document.paths?.[apiPaths.health]?.get;

    expect(Object.keys(document.paths ?? {})).toEqual([apiPaths.health]);
    expect(healthOperation?.responses).toHaveProperty('200');
    expect(healthOperation?.responses).toHaveProperty('503');
    expect(document.components?.schemas).toHaveProperty('HealthResponse');
    expect(document.components?.schemas).toHaveProperty('ApiErrorEnvelope');
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
