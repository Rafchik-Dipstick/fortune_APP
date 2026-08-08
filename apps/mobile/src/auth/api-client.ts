import {
  accountDeletionResponseSchema,
  accountDeletionStateSchema,
  apiErrorEnvelopeSchema,
  apiPaths,
  collectionCardDetailResponseSchema,
  collectionCardPath,
  collectionResponseSchema,
  consumptionConsentSchema,
  fortuneDetailPath,
  fortuneDetailResponseSchema,
  fortuneDrawResponseSchema,
  fortuneHistoryResponseSchema,
  fortuneStateResponseSchema,
  fortuneViewedPath,
  fortuneViewedResponseSchema,
  appleAuthResponseSchema,
  iapCatalogResponseSchema,
  iapReconcileResponseSchema,
  iapStatusResponseSchema,
  iapTransactionResponseSchema,
  meResponseSchema,
  preferencesUpdateResponseSchema,
  refreshSessionResponseSchema,
  type AccountDeletionRequest,
  type AccountDeletionResponse,
  type AccountDeletionState,
  type ApiErrorCode,
  type AuthDevice,
  type CollectionCardDetailResponse,
  type CollectionResponse,
  type ConsumptionConsent,
  type ConsumptionConsentUpdateRequest,
  type FortuneDetailResponse,
  type AppleAuthRequest,
  type AppleAuthResponse,
  type FortuneDrawRequest,
  type FortuneDrawResponse,
  type FortuneHistoryQuery,
  type FortuneHistoryResponse,
  type FortuneStateResponse,
  type FortuneViewedResponse,
  type IapCatalogResponse,
  type IapReconcileResponse,
  type IapStatusResponse,
  type IapTransactionResponse,
  type MeResponse,
  type PreferencesUpdateRequest,
  type PreferencesUpdateResponse,
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

export async function authenticateApple(
  authenticationRequest: AppleAuthRequest,
): Promise<AppleAuthResponse> {
  const response = await request(apiPaths.authApple, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(authenticationRequest),
  });
  const parsed = appleAuthResponseSchema.safeParse(await requireSuccessJson(response));
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

export async function updatePreferences(
  accessToken: string,
  update: PreferencesUpdateRequest,
): Promise<PreferencesUpdateResponse> {
  const response = await request(apiPaths.mePreferences, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(update),
  });
  const parsed = preferencesUpdateResponseSchema.safeParse(await requireSuccessJson(response));
  if (!parsed.success) {
    throw new MobileApiError({
      code: 'RESPONSE_INVALID',
      message: 'The preferences response did not match the application contract.',
      retryable: true,
      statusCode: response.status,
    });
  }
  return parsed.data;
}

export async function requestAccountDeletion(
  accessToken: string,
  confirmations: AccountDeletionRequest,
): Promise<AccountDeletionResponse> {
  const response = await request(apiPaths.me, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(confirmations),
  });
  const parsed = accountDeletionResponseSchema.safeParse(await requireSuccessJson(response));
  if (!parsed.success) {
    throw new MobileApiError({
      code: 'RESPONSE_INVALID',
      message: 'The deletion response did not match the application contract.',
      retryable: true,
      statusCode: response.status,
    });
  }
  return parsed.data;
}

/**
 * Both deletion-management calls carry the short-lived scoped token issued at
 * reauthentication, never an access token: the processing period must not
 * restore ordinary application access (spec section 6.3).
 */
export async function getAccountDeletionStatus(
  deletionManagementToken: string,
): Promise<AccountDeletionState> {
  const response = await request(apiPaths.meDeletion, {
    method: 'GET',
    headers: { Authorization: `Bearer ${deletionManagementToken}` },
  });
  const parsed = accountDeletionStateSchema.safeParse(await requireSuccessJson(response));
  if (!parsed.success) {
    throw new MobileApiError({
      code: 'RESPONSE_INVALID',
      message: 'The deletion status did not match the application contract.',
      retryable: true,
      statusCode: response.status,
    });
  }
  return parsed.data;
}

export async function cancelAccountDeletion(
  deletionManagementToken: string,
): Promise<AppleAuthResponse> {
  const response = await request(apiPaths.meDeletionCancel, {
    method: 'POST',
    headers: { Authorization: `Bearer ${deletionManagementToken}` },
  });
  const parsed = appleAuthResponseSchema.safeParse(await requireSuccessJson(response));
  if (!parsed.success) {
    throw new MobileApiError({
      code: 'RESPONSE_INVALID',
      message: 'The cancellation response did not match the application contract.',
      retryable: true,
      statusCode: response.status,
    });
  }
  return parsed.data;
}

export async function getConsumptionConsent(accessToken: string): Promise<ConsumptionConsent> {
  const response = await request(apiPaths.meConsumptionConsent, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const parsed = consumptionConsentSchema.safeParse(await requireSuccessJson(response));
  if (!parsed.success) {
    throw new MobileApiError({
      code: 'RESPONSE_INVALID',
      message: 'The consent state did not match the application contract.',
      retryable: true,
      statusCode: response.status,
    });
  }
  return parsed.data;
}

export async function setConsumptionConsent(
  accessToken: string,
  decision: ConsumptionConsentUpdateRequest,
): Promise<ConsumptionConsent> {
  const response = await request(apiPaths.meConsumptionConsent, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(decision),
  });
  const parsed = consumptionConsentSchema.safeParse(await requireSuccessJson(response));
  if (!parsed.success) {
    throw new MobileApiError({
      code: 'RESPONSE_INVALID',
      message: 'The consent response did not match the application contract.',
      retryable: true,
      statusCode: response.status,
    });
  }
  return parsed.data;
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

function buildQueryString(parameters: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(parameters)) {
    if (value !== undefined) {
      query.set(name, String(value));
    }
  }
  const serialized = query.toString();
  return serialized.length === 0 ? '' : `?${serialized}`;
}

export async function getFortuneHistory(
  accessToken: string,
  query: Partial<FortuneHistoryQuery> = {},
): Promise<FortuneHistoryResponse> {
  const response = await request(`${apiPaths.fortunes}${buildQueryString(query)}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const parsed = fortuneHistoryResponseSchema.safeParse(await requireSuccessJson(response));
  if (!parsed.success) {
    throw new MobileApiError({
      code: 'RESPONSE_INVALID',
      message: 'The reading history did not match the application contract.',
      retryable: true,
      statusCode: response.status,
    });
  }
  return parsed.data;
}

export async function getFortuneDetail(
  accessToken: string,
  drawId: string,
): Promise<FortuneDetailResponse> {
  const response = await request(fortuneDetailPath(drawId), {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const parsed = fortuneDetailResponseSchema.safeParse(await requireSuccessJson(response));
  if (!parsed.success) {
    throw new MobileApiError({
      code: 'RESPONSE_INVALID',
      message: 'The reading detail did not match the application contract.',
      retryable: true,
      statusCode: response.status,
    });
  }
  return parsed.data;
}

export async function getCollection(accessToken: string): Promise<CollectionResponse> {
  const response = await request(apiPaths.collection, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const parsed = collectionResponseSchema.safeParse(await requireSuccessJson(response));
  if (!parsed.success) {
    throw new MobileApiError({
      code: 'RESPONSE_INVALID',
      message: 'The collection summary did not match the application contract.',
      retryable: true,
      statusCode: response.status,
    });
  }
  return parsed.data;
}

export async function getCollectionCard(
  accessToken: string,
  cardKey: string,
  query: { cursor?: string; limit?: number } = {},
): Promise<CollectionCardDetailResponse> {
  const response = await request(`${collectionCardPath(cardKey)}${buildQueryString(query)}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const parsed = collectionCardDetailResponseSchema.safeParse(await requireSuccessJson(response));
  if (!parsed.success) {
    throw new MobileApiError({
      code: 'RESPONSE_INVALID',
      message: 'The card detail did not match the application contract.',
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

export async function getIapCatalog(accessToken: string): Promise<IapCatalogResponse> {
  const response = await request(apiPaths.iapCatalog, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const parsed = iapCatalogResponseSchema.safeParse(await requireSuccessJson(response));
  if (!parsed.success) {
    throw new MobileApiError({
      code: 'RESPONSE_INVALID',
      message: 'The commerce catalog did not match the application contract.',
      retryable: true,
      statusCode: response.status,
    });
  }
  return parsed.data;
}

export async function getIapStatus(accessToken: string): Promise<IapStatusResponse> {
  const response = await request(apiPaths.iapStatus, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const parsed = iapStatusResponseSchema.safeParse(await requireSuccessJson(response));
  if (!parsed.success) {
    throw new MobileApiError({
      code: 'RESPONSE_INVALID',
      message: 'The commerce status did not match the application contract.',
      retryable: true,
      statusCode: response.status,
    });
  }
  return parsed.data;
}

export async function deliverIapTransaction(
  accessToken: string,
  signedTransaction: string,
): Promise<IapTransactionResponse> {
  const response = await request(apiPaths.iapTransactions, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ signedTransaction }),
  });
  const parsed = iapTransactionResponseSchema.safeParse(await requireSuccessJson(response));
  if (!parsed.success) {
    throw new MobileApiError({
      code: 'RESPONSE_INVALID',
      message: 'The transaction delivery did not match the application contract.',
      retryable: true,
      statusCode: response.status,
    });
  }
  return parsed.data;
}

export async function reconcileIapTransactions(
  accessToken: string,
  signedTransactions: readonly string[],
): Promise<IapReconcileResponse> {
  const response = await request(apiPaths.iapReconcile, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ transactions: signedTransactions }),
  });
  const parsed = iapReconcileResponseSchema.safeParse(await requireSuccessJson(response));
  if (!parsed.success) {
    throw new MobileApiError({
      code: 'RESPONSE_INVALID',
      message: 'The transaction reconciliation did not match the application contract.',
      retryable: true,
      statusCode: response.status,
    });
  }
  return parsed.data;
}
