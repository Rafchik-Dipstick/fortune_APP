import { type Express, type RequestHandler } from 'express';
import {
  accountDeletionRequestSchema,
  accountDeletionResponseSchema,
  accountDeletionStateSchema,
  apiPaths,
  consumptionConsentSchema,
  consumptionConsentUpdateRequestSchema,
  gameCenterAuthResponseSchema,
  preferencesUpdateRequestSchema,
  preferencesUpdateResponseSchema,
  type AccountDeletionRequest,
  type AccountDeletionResponse,
  type AccountDeletionState,
  type ConsumptionConsent,
  type ConsumptionConsentUpdateRequest,
  type GameCenterAuthResponse,
  type PreferencesUpdateRequest,
  type PreferencesUpdateResponse,
} from '@fortuneness/api-contracts';

import { ConsumptionConsentError } from '../account/consumption-consent.js';
import { AccountDeletionError } from '../account/deletion.js';
import { PreferencesError } from '../account/preferences.js';
import { type AuthenticationContext } from '../middleware/authentication.js';
import { ApiHttpError } from '../middleware/errors.js';

export interface PreferencesHandler {
  update(
    authentication: AuthenticationContext,
    update: PreferencesUpdateRequest,
  ): Promise<PreferencesUpdateResponse>;
}

export interface AccountDeletionHandler {
  cancel(userId: string, authenticatedAt: Date): Promise<GameCenterAuthResponse>;
  request(
    authentication: AuthenticationContext,
    confirmations: AccountDeletionRequest,
  ): Promise<AccountDeletionResponse>;
  status(userId: string): Promise<AccountDeletionState>;
}

export interface ConsumptionConsentHandler {
  get(authentication: AuthenticationContext): Promise<ConsumptionConsent>;
  set(
    authentication: AuthenticationContext,
    decision: ConsumptionConsentUpdateRequest,
  ): Promise<ConsumptionConsent>;
}

function mapPreferencesError(error: PreferencesError): ApiHttpError {
  switch (error.code) {
    case 'ACCOUNT_DELETION_PENDING':
      return new ApiHttpError({
        code: 'ACCOUNT_DELETION_PENDING',
        message: 'The account is pending deletion.',
        statusCode: 423,
      });
    case 'ACCOUNT_PURGED':
      return new ApiHttpError({
        code: 'ACCOUNT_PURGED',
        message: 'The account has been purged.',
        statusCode: 410,
      });
    case 'AUTH_REQUIRED':
      return new ApiHttpError({
        code: 'AUTH_REQUIRED',
        message: 'An active session is required.',
        retryable: true,
        statusCode: 401,
      });
    case 'TIME_ZONE_CHANGE_LIMITED':
      return new ApiHttpError({
        code: 'TIME_ZONE_CHANGE_LIMITED',
        ...(error.nextEligibleAt === undefined
          ? {}
          : { details: { nextEligibleAt: error.nextEligibleAt.toISOString() } }),
        message: 'The account time zone cannot be changed again yet.',
        statusCode: 409,
      });
    case 'VALIDATION_FAILED':
      return new ApiHttpError({
        code: 'VALIDATION_FAILED',
        message: 'The requested time zone is not a recognized IANA zone.',
        statusCode: 400,
      });
  }
}

function mapDeletionError(error: AccountDeletionError): ApiHttpError {
  switch (error.code) {
    case 'ACCOUNT_DELETION_PENDING':
      return new ApiHttpError({
        code: 'ACCOUNT_DELETION_PENDING',
        message:
          'This account already has a pending deletion request. Reauthenticate with Game Center to see its status.',
        statusCode: 423,
      });
    case 'ACCOUNT_PURGED':
      return new ApiHttpError({
        code: 'ACCOUNT_PURGED',
        message: 'The account has been purged and cannot be restored.',
        statusCode: 410,
      });
    case 'AUTH_REQUIRED':
      return new ApiHttpError({
        code: 'AUTH_REQUIRED',
        message: 'An active session is required.',
        retryable: true,
        statusCode: 401,
      });
    case 'GAME_CENTER_REAUTH_REQUIRED':
      return new ApiHttpError({
        code: 'GAME_CENTER_REAUTH_REQUIRED',
        message:
          'Account deletion requires a Game Center sign-in from the last 300 seconds. Reauthenticate and try again.',
        retryable: true,
        statusCode: 401,
      });
    case 'RETRYABLE_CONFLICT':
      return new ApiHttpError({
        code: 'RETRYABLE_CONFLICT',
        message: 'A retryable conflict occurred. Try again.',
        retryable: true,
        sameKeyRetrySafe: true,
        statusCode: 503,
      });
    case 'VALIDATION_FAILED':
      return new ApiHttpError({
        code: 'VALIDATION_FAILED',
        message: error.detail ?? 'The deletion request is missing a required acknowledgement.',
        statusCode: 400,
      });
  }
}

function mapConsentError(error: ConsumptionConsentError): ApiHttpError {
  return error.code === 'AUTH_REQUIRED'
    ? new ApiHttpError({
        code: 'AUTH_REQUIRED',
        message: 'An active session is required.',
        retryable: true,
        statusCode: 401,
      })
    : new ApiHttpError({
        code: 'VALIDATION_FAILED',
        message: 'This consent control is not available in this deployment.',
        statusCode: 400,
      });
}

function createPreferencesRoute(handler: PreferencesHandler): RequestHandler {
  return async (request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    const parsed = preferencesUpdateRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      next(
        new ApiHttpError({
          code: 'VALIDATION_FAILED',
          message: 'The preferences update must contain at least one allowlisted field.',
          statusCode: 400,
        }),
      );
      return;
    }
    try {
      response
        .status(200)
        .json(
          preferencesUpdateResponseSchema.parse(
            await handler.update(request.authentication, parsed.data),
          ),
        );
    } catch (error) {
      next(error instanceof PreferencesError ? mapPreferencesError(error) : error);
    }
  };
}

function createDeletionRequestRoute(handler: AccountDeletionHandler): RequestHandler {
  return async (request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    const parsed = accountDeletionRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      next(
        new ApiHttpError({
          code: 'VALIDATION_FAILED',
          message:
            'Deletion requires the current confirmation version and both standard acknowledgements.',
          statusCode: 400,
        }),
      );
      return;
    }
    try {
      response
        .status(202)
        .json(
          accountDeletionResponseSchema.parse(
            await handler.request(request.authentication, parsed.data),
          ),
        );
    } catch (error) {
      next(error instanceof AccountDeletionError ? mapDeletionError(error) : error);
    }
  };
}

function createDeletionStatusRoute(handler: AccountDeletionHandler): RequestHandler {
  return async (request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    try {
      response
        .status(200)
        .json(
          accountDeletionStateSchema.parse(await handler.status(request.deletionManagementUserId)),
        );
    } catch (error) {
      next(error instanceof AccountDeletionError ? mapDeletionError(error) : error);
    }
  };
}

function createDeletionCancelRoute(handler: AccountDeletionHandler): RequestHandler {
  return async (request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    try {
      response
        .status(200)
        .json(
          gameCenterAuthResponseSchema.parse(
            await handler.cancel(
              request.deletionManagementUserId,
              request.deletionManagementAuthTime,
            ),
          ),
        );
    } catch (error) {
      next(error instanceof AccountDeletionError ? mapDeletionError(error) : error);
    }
  };
}

function createConsentReadRoute(handler: ConsumptionConsentHandler): RequestHandler {
  return async (request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    try {
      response
        .status(200)
        .json(consumptionConsentSchema.parse(await handler.get(request.authentication)));
    } catch (error) {
      next(error instanceof ConsumptionConsentError ? mapConsentError(error) : error);
    }
  };
}

function createConsentWriteRoute(handler: ConsumptionConsentHandler): RequestHandler {
  return async (request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    const parsed = consumptionConsentUpdateRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      next(
        new ApiHttpError({
          code: 'VALIDATION_FAILED',
          message: 'A consent update needs an explicit decision and the policy version shown.',
          statusCode: 400,
        }),
      );
      return;
    }
    try {
      response
        .status(200)
        .json(
          consumptionConsentSchema.parse(await handler.set(request.authentication, parsed.data)),
        );
    } catch (error) {
      next(error instanceof ConsumptionConsentError ? mapConsentError(error) : error);
    }
  };
}

export function registerAccountRoutes(
  app: Express,
  handlers: {
    authenticate: RequestHandler;
    authenticateDeletionManagement: RequestHandler;
    consumptionConsent: ConsumptionConsentHandler;
    deletion: AccountDeletionHandler;
    preferences: PreferencesHandler;
  },
): void {
  app.patch(
    apiPaths.mePreferences,
    handlers.authenticate,
    createPreferencesRoute(handlers.preferences),
  );
  app.delete(apiPaths.me, handlers.authenticate, createDeletionRequestRoute(handlers.deletion));
  app.get(
    apiPaths.meDeletion,
    handlers.authenticateDeletionManagement,
    createDeletionStatusRoute(handlers.deletion),
  );
  app.post(
    apiPaths.meDeletionCancel,
    handlers.authenticateDeletionManagement,
    createDeletionCancelRoute(handlers.deletion),
  );
  app.get(
    apiPaths.meConsumptionConsent,
    handlers.authenticate,
    createConsentReadRoute(handlers.consumptionConsent),
  );
  app.put(
    apiPaths.meConsumptionConsent,
    handlers.authenticate,
    createConsentWriteRoute(handlers.consumptionConsent),
  );
}
