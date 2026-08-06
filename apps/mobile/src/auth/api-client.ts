import {
  apiErrorEnvelopeSchema,
  apiPaths,
  gameCenterAuthResponseSchema,
  meResponseSchema,
  refreshSessionResponseSchema,
  type ApiErrorCode,
  type AuthDevice,
  type GameCenterAuthRequest,
  type GameCenterAuthResponse,
  type MeResponse,
  type RefreshSessionResponse,
} from '@fortuneness/api-contracts';

import { publicEnvironment } from '../config/public-environment';

const requestTimeoutMs = 10_000;

export class MobileApiError extends Error {
  readonly code: ApiErrorCode | 'NETWORK_UNAVAILABLE' | 'RESPONSE_INVALID';
  readonly retryable: boolean;
  readonly statusCode: number | undefined;

  constructor(options: {
    cause?: unknown;
    code: MobileApiError['code'];
    message: string;
    retryable: boolean;
    statusCode?: number;
  }) {
    super(options.message, { cause: options.cause });
    this.name = 'MobileApiError';
    this.code = options.code;
    this.retryable = options.retryable;
    this.statusCode = options.statusCode;
  }
}

async function request(path: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  const timeout = setTimeout(() => {
    controller.abort();
  }, requestTimeoutMs);
  try {
    return await fetch(`${publicEnvironment.apiUrl}${path}`, {
      ...init,
      signal: controller.signal,
      headers,
    });
  } catch (error) {
    throw new MobileApiError({
      cause: error,
      code: 'NETWORK_UNAVAILABLE',
      message: 'The Fortuneness service could not be reached.',
      retryable: true,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function parseResponseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    throw new MobileApiError({
      cause: error,
      code: 'RESPONSE_INVALID',
      message: 'The Fortuneness service returned an invalid response.',
      retryable: true,
      statusCode: response.status,
    });
  }
}

async function requireSuccessJson(response: Response): Promise<unknown> {
  const payload = await parseResponseJson(response);
  if (!response.ok) {
    const parsedError = apiErrorEnvelopeSchema.safeParse(payload);
    if (parsedError.success) {
      throw new MobileApiError({
        code: parsedError.data.error.code,
        message: parsedError.data.error.message,
        retryable: parsedError.data.error.retryable,
        statusCode: response.status,
      });
    }
    throw new MobileApiError({
      code: 'RESPONSE_INVALID',
      message: 'The Fortuneness service returned an invalid error response.',
      retryable: true,
      statusCode: response.status,
    });
  }
  return payload;
}

export async function authenticateGameCenter(
  authenticationRequest: GameCenterAuthRequest,
): Promise<GameCenterAuthResponse> {
  const response = await request(apiPaths.authGameCenter, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(authenticationRequest),
  });
  const parsed = gameCenterAuthResponseSchema.safeParse(await requireSuccessJson(response));
  if (!parsed.success) {
    throw new MobileApiError({
      code: 'RESPONSE_INVALID',
      message: 'The authentication response did not match the application contract.',
      retryable: true,
      statusCode: response.status,
    });
  }
  return parsed.data;
}

export async function refreshSession(
  refreshToken: string,
  device: AuthDevice,
  idempotencyKey: string,
): Promise<RefreshSessionResponse> {
  const response = await request(apiPaths.authRefresh, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({ refreshToken, device }),
  });
  const parsed = refreshSessionResponseSchema.safeParse(await requireSuccessJson(response));
  if (!parsed.success) {
    throw new MobileApiError({
      code: 'RESPONSE_INVALID',
      message: 'The refresh response did not match the application contract.',
      retryable: true,
      statusCode: response.status,
    });
  }
  return parsed.data;
}

export async function getAccountBootstrap(accessToken: string): Promise<MeResponse> {
  const response = await request(apiPaths.me, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const parsed = meResponseSchema.safeParse(await requireSuccessJson(response));
  if (!parsed.success) {
    throw new MobileApiError({
      code: 'RESPONSE_INVALID',
      message: 'The account response did not match the application contract.',
      retryable: true,
      statusCode: response.status,
    });
  }
  return parsed.data;
}

export async function logoutSession(accessToken: string): Promise<void> {
  const response = await request(apiPaths.authLogout, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (response.status === 204) {
    return;
  }
  await requireSuccessJson(response);
  throw new MobileApiError({
    code: 'RESPONSE_INVALID',
    message: 'The logout response did not match the application contract.',
    retryable: true,
    statusCode: response.status,
  });
}
