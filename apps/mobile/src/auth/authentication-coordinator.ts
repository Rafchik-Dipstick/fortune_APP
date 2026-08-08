import {
  appleAuthRequestSchema,
  deletionManagementSchema,
  type AppleAuthRequest,
  type AppleAuthResponse,
  type AuthDevice,
  type DeletionManagement,
  type MeResponse,
  type RefreshSessionResponse,
} from '@fortuneness/api-contracts';

import { MobileApiError } from './api-client';
import type { StoredCredentials } from './session-storage';

const accountInvalidatingErrorCodes = new Set<MobileApiError['code']>([
  'ACCOUNT_DELETION_PENDING',
  'ACCOUNT_PURGED',
  'AUTH_REQUIRED',
]);

function invalidatesStoredAccount(error: unknown): boolean {
  return error instanceof MobileApiError && accountInvalidatingErrorCodes.has(error.code);
}

function isAppleSignInCancellation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ERR_REQUEST_CANCELED'
  );
}

export type AuthenticationPhase =
  | 'APPLE_SIGN_IN_REQUIRED'
  | 'AUTHENTICATED'
  | 'AUTHENTICATING'
  | 'DELETION_PENDING'
  | 'ERROR'
  | 'PURGED'
  | 'STARTING'
  | 'UNSUPPORTED';

export interface AuthenticatedMobileSession {
  accessToken: string;
  accessTokenExpiresAt: string;
  accountLabel: string;
  bootstrap: MeResponse['bootstrap'];
  identityFingerprint: string;
  user: MeResponse['user'];
}

export interface AuthenticationState {
  deletionManagement?: DeletionManagement;
  failureDetail?: string;
  phase: AuthenticationPhase;
  session?: AuthenticatedMobileSession;
}

function describeFailure(error: unknown): string {
  if (error instanceof MobileApiError) {
    return `${error.code}${error.statusCode === undefined ? '' : ` ${String(error.statusCode)}`}: ${error.message}`;
  }
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}

export interface AppleSignInCredential {
  identityToken: string | null;
  user: string;
}

export interface AuthenticationCoordinatorDependencies {
  api: {
    authenticate(request: AppleAuthRequest): Promise<AppleAuthResponse>;
    bootstrap(accessToken: string): Promise<MeResponse>;
    logout(accessToken: string): Promise<void>;
    refresh(
      refreshToken: string,
      device: AuthDevice,
      idempotencyKey: string,
    ): Promise<RefreshSessionResponse>;
  };
  clearAccountData(): Promise<void>;
  createUuid(): string;
  deviceContext(): { locale: string; timeZone: string };
  fingerprint(appleUserId: string): Promise<string>;
  native: {
    isAvailable(): Promise<boolean>;
    signIn(nonce: string): Promise<AppleSignInCredential>;
  };
  now?: () => number;
  storage: {
    getDeviceId(createUuid: () => string): Promise<string>;
    load(): Promise<StoredCredentials | undefined>;
    save(credentials: StoredCredentials): Promise<void>;
  };
}

type AuthenticationListener = (state: AuthenticationState) => void;

const maximumTimerDelayMs = 2_147_483_647;
const appleAccountLabel = 'Apple Account';

export class AuthenticationCoordinator {
  private activeGeneration = 0;
  private activeIdentityFingerprint: string | undefined;
  private currentState: AuthenticationState = { phase: 'STARTING' };
  private readonly listeners = new Set<AuthenticationListener>();
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly dependencies: AuthenticationCoordinatorDependencies) {}

  get state(): AuthenticationState {
    return this.currentState;
  }

  subscribe(listener: AuthenticationListener): () => void {
    this.listeners.add(listener);
    listener(this.currentState);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async start(): Promise<void> {
    this.publish({ phase: 'AUTHENTICATING' });
    try {
      if (!(await this.dependencies.native.isAvailable())) {
        await this.invalidateAccount();
        this.publish({ phase: 'UNSUPPORTED' });
        return;
      }
      const stored = await this.dependencies.storage.load();
      if (stored === undefined) {
        this.publish({ phase: 'APPLE_SIGN_IN_REQUIRED' });
        return;
      }
      await this.restoreStoredSession(stored);
    } catch (error) {
      await this.handleAuthenticationFailure(error);
    }
  }

  stop(): void {
    this.activeGeneration += 1;
    this.cancelRefreshTimer();
  }

  async retry(): Promise<void> {
    this.publish({ phase: 'AUTHENTICATING' });
    try {
      const stored = await this.dependencies.storage.load();
      if (stored === undefined) {
        await this.signIn();
      } else {
        await this.restoreStoredSession(stored);
      }
    } catch (error) {
      await this.handleAuthenticationFailure(error);
    }
  }

  async disconnect(): Promise<void> {
    const accessToken = this.currentState.session?.accessToken;
    if (accessToken !== undefined) {
      try {
        await this.dependencies.api.logout(accessToken);
      } catch {
        // Local removal completes logout even when the server family is gone.
      }
    }
    await this.invalidateAccount();
    this.publish({ phase: 'APPLE_SIGN_IN_REQUIRED' });
  }

  applyAccountUpdate(user: MeResponse['user']): void {
    const session = this.currentState.session;
    if (session === undefined || this.currentState.phase !== 'AUTHENTICATED') {
      return;
    }
    this.publish({ phase: 'AUTHENTICATED', session: { ...session, user } });
  }

  async reauthenticate(): Promise<boolean> {
    const previousState = this.currentState;
    this.publish({ phase: 'AUTHENTICATING' });
    try {
      const credential = await this.requestAppleCredential();
      const identityFingerprint = await this.dependencies.fingerprint(credential.user);
      if (
        this.activeIdentityFingerprint !== undefined &&
        this.activeIdentityFingerprint !== identityFingerprint
      ) {
        this.publish(previousState);
        return false;
      }
      await this.exchangeCredential(credential, identityFingerprint);
      return this.currentState.phase === 'AUTHENTICATED';
    } catch (error) {
      if (
        previousState.phase === 'AUTHENTICATED' &&
        (isAppleSignInCancellation(error) || !invalidatesStoredAccount(error))
      ) {
        this.publish(previousState);
        return false;
      }
      await this.handleAuthenticationFailure(error);
      return false;
    }
  }

  async enterDeletionPending(deletionManagement?: DeletionManagement): Promise<void> {
    const identityFingerprint = this.activeIdentityFingerprint;
    await this.invalidateAccount();
    this.activeIdentityFingerprint = identityFingerprint;
    this.publish({
      ...(deletionManagement === undefined ? {} : { deletionManagement }),
      phase: 'DELETION_PENDING',
    });
  }

  async resumeAfterDeletionCancelled(response: AppleAuthResponse): Promise<void> {
    const identityFingerprint = this.activeIdentityFingerprint;
    if (identityFingerprint === undefined) {
      this.publish({ phase: 'APPLE_SIGN_IN_REQUIRED' });
      return;
    }
    await this.establishSession(
      identityFingerprint,
      { session: response.session },
      { user: response.user, bootstrap: response.bootstrap },
      ++this.activeGeneration,
    );
  }

  private async signIn(): Promise<void> {
    if (!(await this.dependencies.native.isAvailable())) {
      await this.invalidateAccount();
      this.publish({ phase: 'UNSUPPORTED' });
      return;
    }
    const credential = await this.requestAppleCredential();
    const identityFingerprint = await this.dependencies.fingerprint(credential.user);
    if (
      this.activeIdentityFingerprint !== undefined &&
      this.activeIdentityFingerprint !== identityFingerprint
    ) {
      await this.invalidateAccount();
    }
    this.activeIdentityFingerprint = identityFingerprint;
    await this.exchangeCredential(credential, identityFingerprint);
  }

  private async requestAppleCredential(): Promise<AppleSignInCredential & { nonce: string }> {
    const nonce = this.dependencies.createUuid();
    const credential = await this.dependencies.native.signIn(nonce);
    if (credential.identityToken === null) {
      throw new MobileApiError({
        code: 'APPLE_ID_TOKEN_INVALID',
        message: 'Apple did not return an identity token.',
        retryable: true,
      });
    }
    return { ...credential, nonce };
  }

  private async restoreStoredSession(stored: StoredCredentials): Promise<void> {
    this.activeIdentityFingerprint = stored.identityFingerprint;
    const generation = ++this.activeGeneration;
    try {
      const refreshed = await this.dependencies.api.refresh(
        stored.refreshToken,
        await this.device(),
        await this.refreshIdempotencyKey(stored),
      );
      const rotated: StoredCredentials = {
        ...stored,
        refreshIdempotencyKey: this.dependencies.createUuid(),
        refreshToken: refreshed.session.refreshToken,
      };
      await this.dependencies.storage.save(rotated);
      const bootstrap = await this.dependencies.api.bootstrap(refreshed.session.accessToken);
      if (bootstrap.user.id !== stored.userId) {
        await this.invalidateAccount();
        this.publish({ phase: 'APPLE_SIGN_IN_REQUIRED' });
        return;
      }
      await this.establishSession(stored.identityFingerprint, refreshed, bootstrap, generation);
    } catch (error) {
      if (invalidatesStoredAccount(error)) {
        await this.invalidateAccount();
        this.publish({ phase: 'APPLE_SIGN_IN_REQUIRED' });
        return;
      }
      throw error;
    }
  }

  private async exchangeCredential(
    credential: AppleSignInCredential & { nonce: string },
    identityFingerprint: string,
  ): Promise<void> {
    const generation = ++this.activeGeneration;
    const deviceContext = this.dependencies.deviceContext();
    try {
      const response = await this.dependencies.api.authenticate(
        appleAuthRequestSchema.parse({
          identityToken: credential.identityToken,
          nonce: credential.nonce,
          reportedDeviceLocale: deviceContext.locale,
          reportedDeviceTimeZone: deviceContext.timeZone,
          device: await this.device(),
        }),
      );
      await this.establishSession(
        identityFingerprint,
        { session: response.session },
        { user: response.user, bootstrap: response.bootstrap },
        generation,
      );
    } catch (error) {
      if (error instanceof MobileApiError && error.code === 'ACCOUNT_DELETION_PENDING') {
        const management = deletionManagementSchema.safeParse(error.details);
        await this.dependencies.clearAccountData();
        this.discardActiveSession();
        this.activeIdentityFingerprint = identityFingerprint;
        this.publish({
          ...(management.success ? { deletionManagement: management.data } : {}),
          phase: 'DELETION_PENDING',
        });
        return;
      }
      throw error;
    }
  }

  private async establishSession(
    identityFingerprint: string,
    tokens: RefreshSessionResponse,
    account: MeResponse,
    generation: number,
  ): Promise<void> {
    if (generation !== this.activeGeneration) {
      return;
    }
    await this.dependencies.storage.save({
      appAccountToken: account.bootstrap.appAccountToken,
      identityFingerprint,
      refreshIdempotencyKey: this.dependencies.createUuid(),
      refreshToken: tokens.session.refreshToken,
      userId: account.user.id,
    });
    if (generation !== this.activeGeneration) {
      await this.invalidateAccount();
      return;
    }
    this.activeIdentityFingerprint = identityFingerprint;
    const session: AuthenticatedMobileSession = {
      accessToken: tokens.session.accessToken,
      accessTokenExpiresAt: tokens.session.accessTokenExpiresAt,
      accountLabel: appleAccountLabel,
      bootstrap: account.bootstrap,
      identityFingerprint,
      user: account.user,
    };
    this.publish({ phase: 'AUTHENTICATED', session });
    this.scheduleRefresh(session);
  }

  private scheduleRefresh(session: AuthenticatedMobileSession): void {
    this.cancelRefreshTimer();
    const delay = Math.min(
      maximumTimerDelayMs,
      Math.max(
        1_000,
        new Date(session.accessTokenExpiresAt).getTime() -
          (this.dependencies.now?.() ?? Date.now()) -
          30_000,
      ),
    );
    this.refreshTimer = setTimeout(() => {
      void this.refreshCurrentSession(session);
    }, delay);
  }

  private async refreshCurrentSession(session: AuthenticatedMobileSession): Promise<void> {
    if (this.currentState.session?.accessToken !== session.accessToken) {
      return;
    }
    try {
      const stored = await this.dependencies.storage.load();
      if (stored?.identityFingerprint !== session.identityFingerprint) {
        throw new MobileApiError({
          code: 'AUTH_REQUIRED',
          message: 'The local refresh session is unavailable.',
          retryable: false,
        });
      }
      await this.restoreStoredSession(stored);
    } catch (error) {
      await this.handleAuthenticationFailure(error);
    }
  }

  private async refreshIdempotencyKey(stored: StoredCredentials): Promise<string> {
    if (stored.refreshIdempotencyKey !== undefined) {
      return stored.refreshIdempotencyKey;
    }
    const minted = this.dependencies.createUuid();
    await this.dependencies.storage.save({ ...stored, refreshIdempotencyKey: minted });
    return minted;
  }

  private async device(): Promise<AuthDevice> {
    return {
      id: await this.dependencies.storage.getDeviceId(() => this.dependencies.createUuid()),
    };
  }

  private async handleAuthenticationFailure(error: unknown): Promise<void> {
    if (isAppleSignInCancellation(error)) {
      this.publish({ phase: 'APPLE_SIGN_IN_REQUIRED' });
      return;
    }
    const failureDetail = describeFailure(error);
    if (error instanceof MobileApiError && error.code === 'ACCOUNT_PURGED') {
      await this.invalidateAccount();
      this.publish({ phase: 'PURGED' });
      return;
    }
    if (invalidatesStoredAccount(error)) {
      await this.invalidateAccount();
    } else {
      this.discardActiveSession();
    }
    this.publish({ failureDetail, phase: 'ERROR' });
  }

  private discardActiveSession(): void {
    this.activeGeneration += 1;
    this.activeIdentityFingerprint = undefined;
    this.cancelRefreshTimer();
  }

  private async invalidateAccount(): Promise<void> {
    this.discardActiveSession();
    await this.dependencies.clearAccountData();
  }

  private cancelRefreshTimer(): void {
    if (this.refreshTimer !== undefined) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }

  private publish(state: AuthenticationState): void {
    this.currentState = state;
    for (const listener of this.listeners) {
      listener(state);
    }
  }
}
