import { type Express, type RequestHandler } from 'express';
import { z } from 'zod';
import {
  apiPaths,
  collectionCardDetailResponseSchema,
  collectionCardReadingsQuerySchema,
  collectionResponseSchema,
  type CollectionCardDetailResponse,
  type CollectionCardReadingsQuery,
  type CollectionResponse,
} from '@fortuneness/api-contracts';

import { CollectionError } from '../fortune/collection.js';
import { type AuthenticationContext } from '../middleware/authentication.js';
import { ApiHttpError } from '../middleware/errors.js';
import { mapFortuneArchiveError } from './fortunes.js';

const cardKeyParamSchema = z
  .string()
  .trim()
  .min(1)
  .max(48)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);

export interface CollectionHandler {
  card(
    authentication: AuthenticationContext,
    cardKey: string,
    query: CollectionCardReadingsQuery,
  ): Promise<CollectionCardDetailResponse>;
  summary(authentication: AuthenticationContext): Promise<CollectionResponse>;
}

function mapCollectionError(error: CollectionError): ApiHttpError {
  if (error.code === 'NOT_FOUND') {
    return new ApiHttpError({
      code: 'NOT_FOUND',
      message: 'The requested card does not exist.',
      statusCode: 404,
    });
  }
  return mapFortuneArchiveError(error);
}

export function createCollectionSummaryRoute(collection: CollectionHandler): RequestHandler {
  return async (request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    try {
      response
        .status(200)
        .json(collectionResponseSchema.parse(await collection.summary(request.authentication)));
    } catch (error) {
      next(error instanceof CollectionError ? mapCollectionError(error) : error);
    }
  };
}

export function createCollectionCardRoute(collection: CollectionHandler): RequestHandler {
  return async (request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    const parsedKey = cardKeyParamSchema.safeParse(request.params['key']);
    const parsedQuery = collectionCardReadingsQuerySchema.safeParse(request.query);
    if (!parsedKey.success || !parsedQuery.success) {
      next(
        new ApiHttpError({
          code: 'VALIDATION_FAILED',
          message: 'The card key, limit, or cursor is invalid.',
          statusCode: 400,
        }),
      );
      return;
    }
    try {
      response
        .status(200)
        .json(
          collectionCardDetailResponseSchema.parse(
            await collection.card(request.authentication, parsedKey.data, parsedQuery.data),
          ),
        );
    } catch (error) {
      next(error instanceof CollectionError ? mapCollectionError(error) : error);
    }
  };
}

export function registerCollectionRoutes(
  app: Express,
  handlers: { authenticate: RequestHandler; collection: CollectionHandler },
): void {
  app.get(
    apiPaths.collection,
    handlers.authenticate,
    createCollectionSummaryRoute(handlers.collection),
  );
  app.get(
    apiPaths.collectionCard,
    handlers.authenticate,
    createCollectionCardRoute(handlers.collection),
  );
}
