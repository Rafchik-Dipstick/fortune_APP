import {
  apiErrorEnvelopeSchema,
  apiPaths,
  fortuneDrawResponseSchema,
  fortuneStateResponseSchema,
  fortuneViewedPath,
  fortuneViewedResponseSchema,
  gameCenterAuthResponseSchema,
  meResponseSchema,
  refreshSessionResponseSchema,
  type ApiErrorCode,
  type AuthDevice,
  type GameCenterAuthRequest,
  type GameCenterAuthResponse,
  type FortuneDrawRequest,
  type FortuneDrawResponse,
  type FortuneStateResponse,
  type FortuneViewedResponse,
  type MeResponse,
  type RefreshSessionResponse,
} from '@fortuneness/api-contracts';

import { publicEnvironment } from '../config/public-environment';

const requestTimeoutMs = 10_000;

export class MobileApiError extends Error {
  readonly code: ApiErrorCode | 'NETWORK_UNAVAILABLE' | 'RESPONSE_INVALID';
  readonly details: unknown;
  readonly retryable: boolean;
  readonly sameKeyRetrySafe: boolean;
  readonly statusCode: number | undefined;

  constructor(options: {
    cause?: unknown;
    code: MobileApiError['code'];
    details?: unknown;
    message: string;
    retryable: boolean;
    sameKeyRetrySafe?: boolean;
    statusCode?: number;
  }) {
    super(options.message, { cause: options.cause });
    this.name = 'MobileApiError';
    this.code = options.code;
    this.details = options.details;
    this.retryable = options.retryable;
    this.sameKeyRetrySafe = options.sameKeyRetrySafe ?? options.retryable;
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
      const details =
        'details' in parsedError.data.error ? parsedError.data.error.details : undefined;
      throw new MobileApiError({
        code: parsedError.data.error.code,
        ...(details === undefined ? {} : { details }),
        message: parsedError.data.error.message,
        retryable: parsedError.data.error.retryable,
        sameKeyRetrySafe: parsedError.data.error.sameKeyRetrySafe,
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

export async function getFortuneState(accessToken: string): Promise<FortuneStateResponse> {
  const response = await request(apiPaths.fortuneState, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const parsed = fortuneStateResponseSchema.safeParse(await requireSuccessJson(response));
  if (!parsed.success) {
    throw new MobileApiError({
      code: 'RESPONSE_INVALID',
      message: 'The fortune state did not match the application contract.',
      retryable: true,
      statusCode: response.status,
    });
  }
  return parsed.data;
}

export async function drawFortune(
  accessToken: string,
  drawRequest: FortuneDrawRequest,
  idempotencyKey: string,
): Promise<FortuneDrawResponse> {
  const response = await request(apiPaths.fortuneDraw, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify(drawRequest),
  });
  const parsed = fortuneDrawResponseSchema.safeParse(await requireSuccessJson(response));
  if (!parsed.success) {
    throw new MobileApiError({
      code: 'RESPONSE_INVALID',
      message: 'The fortune draw did not match the application contract.',
      retryable: true,
      statusCode: response.status,
    });
  }
  return parsed.data;
}

export async function markFortuneViewed(
  accessToken: string,
  drawId: string,
): Promise<FortuneViewedResponse> {
  const response = await request(fortuneViewedPath(drawId), {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const parsed = fortuneViewedResponseSchema.safeParse(await requireSuccessJson(response));
  if (!parsed.success) {
    throw new MobileApiError({
      code: 'RESPONSE_INVALID',
      message: 'The viewed acknowledgement did not match the application contract.',
      retryable: true,
      statusCode: response.status,
    });
  }
  return parsed.data;
}
