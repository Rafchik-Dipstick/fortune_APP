import { type Express, type RequestHandler } from 'express';
import {
  apiPaths,
  appleAuthRequestSchema,
  appleAuthResponseSchema,
  idempotencyKeySchema,
  meResponseSchema,
  refreshSessionRequestSchema,
  refreshSessionResponseSchema,
  type AppleAuthRequest,
  type AppleAuthResponse,
  type MeResponse,
  type RefreshSessionRequest,
  type RefreshSessionResponse,
} from '@fortuneness/api-contracts';

import { AccountBootstrapError } from '../auth/account-bootstrap.js';
import { AppleIdentityVerificationError } from '../auth/apple-auth-errors.js';
import { AppleLoginError } from '../auth/apple-login.js';
import { LogoutSessionError } from '../auth/logout-session.js';
import { RefreshSessionError } from '../auth/refresh-session.js';
import { type AuthenticationContext } from '../middleware/authentication.js';
import { ApiHttpError } from '../middleware/errors.js';

export interface AppleLoginHandler {
  login(request: AppleAuthRequest): Promise<AppleAuthResponse>;
}

export interface RefreshSessionHandler {
  refresh(request: RefreshSessionRequest, idempotencyKey: string): Promise<RefreshSessionResponse>;
}

export interface LogoutSessionHandler {
  logout(authentication: AuthenticationContext): Promise<void>;
}

export interface AccountBootstrapHandler {
  get(authentication: AuthenticationContext): Promise<MeResponse>;
}

function mapVerificationError(error: AppleIdentityVerificationError): ApiHttpError {
  switch (error.code) {
    case 'TOKEN_EXPIRED':
      return new ApiHttpError({
        code: 'APPLE_ID_TOKEN_EXPIRED',
        message: 'The Apple identity token is no longer fresh.',
        retryable: true,
        statusCode: 401,
      });
    case 'KEY_UNAVAILABLE':
      return new ApiHttpError({
        code: 'APPLE_ID_UNAVAILABLE',
        message: 'Apple identity verification is temporarily unavailable.',
        retryable: true,
        statusCode: 503,
      });
    case 'INVALID_TOKEN':
      return new ApiHttpError({
        code: 'APPLE_ID_TOKEN_INVALID',
        message: 'The Apple identity token is invalid.',
        statusCode: 401,
      });
  }
}

function mapLoginError(error: AppleLoginError): ApiHttpError | undefined {
  switch (error.code) {
    case 'PROOF_REPLAY':
      return new ApiHttpError({
        code: 'APPLE_ID_TOKEN_INVALID',
        message: 'The Apple identity token has already been used.',
        statusCode: 401,
      });
    case 'TIME_ZONE_INVALID':
      return new ApiHttpError({
        code: 'VALIDATION_FAILED',
        message: 'The reported device time zone is invalid.',
        statusCode: 400,
      });
    case 'ACCOUNT_BLOCKED':
      return new ApiHttpError({
        code: 'AUTH_REQUIRED',
        message: 'The account cannot establish a session.',
        statusCode: 401,
      });
    case 'ACCOUNT_DELETION_PENDING':
      // Authentication during the processing period hands back the scoped
      // exchange instead of a session, so status and cancellation stay
      // reachable without restoring application access.
      return new ApiHttpError({
        code: 'ACCOUNT_DELETION_PENDING',
        ...(error.deletionManagement === undefined ? {} : { details: error.deletionManagement }),
        message:
          'This account has a pending deletion request. Use the deletion-management token to view its status or cancel it.',
        statusCode: 423,
      });
    case 'ACCOUNT_PURGED':
      return new ApiHttpError({
        code: 'ACCOUNT_PURGED',
        message: 'The account has been purged.',
        statusCode: 410,
      });
    case 'IDENTITY_CONFLICT':
      return undefined;
  }
}

export function createAppleLoginRoute(login: AppleLoginHandler): RequestHandler {
  return async (request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    const parsedRequest = appleAuthRequestSchema.safeParse(request.body);
    if (!parsedRequest.success) {
      next(
        new ApiHttpError({
          code: 'VALIDATION_FAILED',
          message: 'The Apple authentication request is invalid.',
          statusCode: 400,
        }),
      );
      return;
    }

    try {
      const result = appleAuthResponseSchema.parse(await login.login(parsedRequest.data));
      response.status(200).json(result);
    } catch (error) {
      if (error instanceof AppleIdentityVerificationError) {
        next(mapVerificationError(error));
        return;
      }
      if (error instanceof AppleLoginError) {
        next(mapLoginError(error) ?? error);
        return;
      }
      next(error);
    }
  };
}

function mapRefreshError(error: RefreshSessionError): ApiHttpError {
  switch (error.code) {
    case 'IDEMPOTENCY_KEY_REUSED':
      return new ApiHttpError({
        code: 'IDEMPOTENCY_KEY_REUSED',
        message: 'The idempotency key was already used for different refresh input.',
        statusCode: 409,
      });
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
        message: 'A new Apple sign-in is required.',
        statusCode: 401,
      });
  }
}

export function createRefreshSessionRoute(refresh: RefreshSessionHandler): RequestHandler {
  return async (request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    const parsedRequest = refreshSessionRequestSchema.safeParse(request.body);
    const parsedIdempotencyKey = idempotencyKeySchema.safeParse(request.header('idempotency-key'));
    if (!parsedRequest.success || !parsedIdempotencyKey.success) {
      next(
        new ApiHttpError({
          code: 'VALIDATION_FAILED',
          message: 'The refresh request or idempotency key is invalid.',
          statusCode: 400,
        }),
      );
      return;
    }

    try {
      const result = refreshSessionResponseSchema.parse(
        await refresh.refresh(parsedRequest.data, parsedIdempotencyKey.data),
      );
      response.setHeader('Idempotency-Key', parsedIdempotencyKey.data);
      response.status(200).json(result);
    } catch (error) {
      next(error instanceof RefreshSessionError ? mapRefreshError(error) : error);
    }
  };
}

function mapLogoutError(error: LogoutSessionError): ApiHttpError {
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
        message: 'The session is no longer active.',
        statusCode: 401,
      });
  }
}

export function createLogoutRoute(logout: LogoutSessionHandler): RequestHandler {
  return async (request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    try {
      await logout.logout(request.authentication);
      response.status(204).send();
    } catch (error) {
      next(error instanceof LogoutSessionError ? mapLogoutError(error) : error);
    }
  };
}

function mapAccountBootstrapError(error: AccountBootstrapError): ApiHttpError {
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
        message: 'The account bootstrap is unavailable for this session.',
        statusCode: 401,
      });
  }
}

export function createAccountBootstrapRoute(bootstrap: AccountBootstrapHandler): RequestHandler {
  return async (request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    try {
      response
        .status(200)
        .json(meResponseSchema.parse(await bootstrap.get(request.authentication)));
    } catch (error) {
      next(error instanceof AccountBootstrapError ? mapAccountBootstrapError(error) : error);
    }
  };
}

export function registerAuthenticationRoutes(
  app: Express,
  handlers: {
    authenticate: RequestHandler;
    bootstrap: AccountBootstrapHandler;
    login: AppleLoginHandler;
    logout: LogoutSessionHandler;
    refresh: RefreshSessionHandler;
  },
): void {
  app.post(apiPaths.authApple, createAppleLoginRoute(handlers.login));
  app.post(apiPaths.authRefresh, createRefreshSessionRoute(handlers.refresh));
  app.post(apiPaths.authLogout, handlers.authenticate, createLogoutRoute(handlers.logout));
  app.get(apiPaths.me, handlers.authenticate, createAccountBootstrapRoute(handlers.bootstrap));
}
