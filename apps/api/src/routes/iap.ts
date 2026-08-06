import { type Express, type RequestHandler } from 'express';
import {
  apiPaths,
  iapCatalogResponseSchema,
  iapReconcileRequestSchema,
  iapReconcileResponseSchema,
  iapStatusResponseSchema,
  iapTransactionRequestSchema,
  iapTransactionResponseSchema,
  type IapCatalogResponse,
  type IapReconcileResponse,
  type IapStatusResponse,
  type IapTransactionResponse,
} from '@fortuneness/api-contracts';

import { CommerceError, type CommerceErrorCode } from '../iap/commerce.js';
import { type AuthenticationContext } from '../middleware/authentication.js';
import { ApiHttpError } from '../middleware/errors.js';

export interface CommerceHandler {
  catalog(authentication: AuthenticationContext): Promise<IapCatalogResponse>;
  deliver(
    authentication: AuthenticationContext,
    signedTransaction: string,
  ): Promise<IapTransactionResponse>;
  reconcile(
    authentication: AuthenticationContext,
    signedTransactions: readonly string[],
  ): Promise<IapReconcileResponse>;
  status(authentication: AuthenticationContext): Promise<IapStatusResponse>;
}

function mapCommerceError(error: CommerceError): ApiHttpError {
  const mappings: Record<
    CommerceErrorCode,
    { message: string; retryable?: boolean; sameKeyRetrySafe?: boolean; statusCode: number }
  > = {
    ACCOUNT_DELETION_PENDING: {
      message: 'The account is pending deletion.',
      statusCode: 423,
    },
    ACCOUNT_PURGED: {
      message: 'The account has been purged.',
      statusCode: 410,
    },
    AUTH_REQUIRED: {
      message: 'An active session is required for commerce operations.',
      retryable: true,
      statusCode: 401,
    },
    PRODUCT_NOT_ALLOWED: {
      message: 'The product is not in the allowlisted catalog.',
      statusCode: 400,
    },
    RETRYABLE_CONFLICT: {
      message: 'A retryable commerce conflict occurred. Retry without finishing.',
      retryable: true,
      sameKeyRetrySafe: true,
      statusCode: 503,
    },
    TRANSACTION_OWNER_UNKNOWN: {
      message:
        'No account owns this transaction yet. It is quarantined for support review; do not finish it.',
      retryable: true,
      sameKeyRetrySafe: true,
      statusCode: 409,
    },
    TRANSACTION_UNVERIFIED: {
      message: 'The signed transaction could not be verified. Do not finish it.',
      statusCode: 400,
    },
  };
  const mapping = mappings[error.code];
  return new ApiHttpError({ code: error.code, ...mapping });
}

function createCatalogRoute(commerce: CommerceHandler): RequestHandler {
  return async (request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    try {
      response
        .status(200)
        .json(iapCatalogResponseSchema.parse(await commerce.catalog(request.authentication)));
    } catch (error) {
      next(error instanceof CommerceError ? mapCommerceError(error) : error);
    }
  };
}

function createStatusRoute(commerce: CommerceHandler): RequestHandler {
  return async (request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    try {
      response
        .status(200)
        .json(iapStatusResponseSchema.parse(await commerce.status(request.authentication)));
    } catch (error) {
      next(error instanceof CommerceError ? mapCommerceError(error) : error);
    }
  };
}

function createDeliveryRoute(commerce: CommerceHandler): RequestHandler {
  return async (request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    try {
      const parsed = iapTransactionRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        next(
          new ApiHttpError({
            code: 'VALIDATION_FAILED',
            message: 'The delivery request must contain one compact signed transaction.',
            statusCode: 400,
          }),
        );
        return;
      }
      response
        .status(200)
        .json(
          iapTransactionResponseSchema.parse(
            await commerce.deliver(request.authentication, parsed.data.signedTransaction),
          ),
        );
    } catch (error) {
      next(error instanceof CommerceError ? mapCommerceError(error) : error);
    }
  };
}

function createReconcileRoute(commerce: CommerceHandler): RequestHandler {
  return async (request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    try {
      const parsed = iapReconcileRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        next(
          new ApiHttpError({
            code: 'VALIDATION_FAILED',
            message: 'The reconcile batch must contain 1 to 100 compact signed transactions.',
            statusCode: 400,
          }),
        );
        return;
      }
      response
        .status(200)
        .json(
          iapReconcileResponseSchema.parse(
            await commerce.reconcile(request.authentication, parsed.data.transactions),
          ),
        );
    } catch (error) {
      next(error instanceof CommerceError ? mapCommerceError(error) : error);
    }
  };
}

export function registerIapRoutes(
  app: Express,
  handlers: {
    authenticate: RequestHandler;
    commerce: CommerceHandler;
  },
): void {
  app.get(apiPaths.iapCatalog, handlers.authenticate, createCatalogRoute(handlers.commerce));
  app.get(apiPaths.iapStatus, handlers.authenticate, createStatusRoute(handlers.commerce));
  app.post(
    apiPaths.iapTransactions,
    handlers.authenticate,
    createDeliveryRoute(handlers.commerce),
  );
  app.post(
    apiPaths.iapReconcile,
    handlers.authenticate,
    createReconcileRoute(handlers.commerce),
  );
}
