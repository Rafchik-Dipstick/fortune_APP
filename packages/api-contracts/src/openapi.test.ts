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
      apiPaths.fortunes,
      apiPaths.fortuneDetail.replace(':id', '{id}'),
      apiPaths.collection,
      apiPaths.collectionCard.replace(':key', '{key}'),
      apiPaths.fortuneViewed.replace(':id', '{id}'),
      apiPaths.authRefresh,
      apiPaths.authLogout,
      apiPaths.me,
      apiPaths.fortuneState,
      apiPaths.fortuneDraw,
      apiPaths.iapCatalog,
      apiPaths.iapTransactions,
      apiPaths.iapReconcile,
      apiPaths.iapStatus,
      apiPaths.appStoreWebhook,
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

  it('publishes authenticated fortune state and keyed draw contracts', () => {
    const document = generateOpenApiDocument();

    expect(document.paths?.[apiPaths.fortuneState]?.get?.security).toEqual([{ bearerAuth: [] }]);
    expect(document.paths?.[apiPaths.fortuneDraw]?.post?.responses).toHaveProperty('201');
    expect(document.paths?.[apiPaths.fortuneDraw]?.post?.parameters).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'Idempotency-Key', in: 'header' })]),
    );
    expect(document.components?.schemas).toHaveProperty('FortuneAllowanceState');
    expect(document.components?.schemas).toHaveProperty('FortuneDraw');
    expect(document.components?.schemas).toHaveProperty('FortuneDrawRequest');
    expect(document.components?.schemas).toHaveProperty('FortuneViewedResponse');
  });

  it('publishes authenticated collection and history contracts', () => {
    const document = generateOpenApiDocument();
    const historyOperation = document.paths?.[apiPaths.fortunes]?.get;
    const cardOperation = document.paths?.[apiPaths.collectionCard.replace(':key', '{key}')]?.get;

    expect(historyOperation?.security).toEqual([{ bearerAuth: [] }]);
    expect(historyOperation?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'cursor', in: 'query' }),
        expect.objectContaining({ name: 'limit', in: 'query' }),
        expect.objectContaining({ name: 'intention', in: 'query' }),
      ]),
    );
    expect(document.paths?.[apiPaths.collection]?.get?.security).toEqual([{ bearerAuth: [] }]);
    expect(cardOperation?.parameters).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'key', in: 'path' })]),
    );
    expect(document.components?.schemas).toHaveProperty('FortuneHistoryResponse');
    expect(document.components?.schemas).toHaveProperty('FortuneDetailResponse');
    expect(document.components?.schemas).toHaveProperty('CollectionResponse');
    expect(document.components?.schemas).toHaveProperty('CollectionCardDetailResponse');
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
