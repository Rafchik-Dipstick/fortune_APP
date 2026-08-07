import {
  deletionManagementSchema,
  gameCenterAuthRequestSchema,
  type AuthDevice,
  type DeletionManagement,
  type GameCenterAuthRequest,
  type GameCenterAuthResponse,
  type MeResponse,
  type RefreshSessionResponse,
} from '@fortuneness/api-contracts';

import type {
  GameCenterIdentityVerificationItems,
  GameCenterPlayerState,
} from '../../modules/game-center';
import { MobileApiError } from './api-client';
import type { StoredCredentials } from './session-storage';

/**
 * The only failures that prove the stored identity is dead. Everything else --
 * a 5xx, a rate limit, a timeout, an unparseable body, a bug in this file --
 * is the server or the app having a bad moment, and must never be answered by
 * deleting the keychain credentials and the local reading archive behind them.
 */
const accountInvalidatingErrorCodes = new Set<MobileApiError['code']>([
  'ACCOUNT_DELETION_PENDING',
  'ACCOUNT_PURGED',
  'AUTH_REQUIRED',
  'GAME_CENTER_ID_NOT_PERSISTENT',
]);

function invalidatesStoredAccount(error: unknown): boolean {
  return error instanceof MobileApiError && accountInvalidatingErrorCodes.has(error.code);
}

export type AuthenticationPhase =
  | 'AUTHENTICATED'
  | 'AUTHENTICATING'
  | 'DELETION_PENDING'
  | 'ERROR'
  | 'GAME_CENTER_BLOCKED'
  | 'NONPERSISTENT_ID'
  | 'PURGED'
  | 'STARTING'
  | 'UNSUPPORTED';

export interface AuthenticatedMobileSession {
  accessToken: string;
  accessTokenExpiresAt: string;
  alias: string;
  bootstrap: MeResponse['bootstrap'];
  playerFingerprint: string;
  user: MeResponse['user'];
}

export interface AuthenticationState {
  /** Present only in `DELETION_PENDING`: the scoped status/cancel exchange. */
  deletionManagement?: DeletionManagement;
  /**
   * Why the last attempt failed, for the development diagnostics panel only.
   * A blocked gate otherwise reports a single generic phase no matter whether
   * the native proof, the network, or the server refused, which is unreadable
   * from the device.
   */
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

interface RemovableSubscription {
  remove(): void;
}

export interface AuthenticationCoordinatorDependencies {
  api: {
    authenticate(request: GameCenterAuthRequest): Promise<GameCenterAuthResponse>;
    bootstrap(accessToken: string): Promise<MeResponse>;
    logout(accessToken: string): Promise<void>;
    refresh(
      refreshToken: string,
      device: AuthDevice,
      idempotencyKey: string,
    ): Promise<RefreshSessionResponse>;
  };
  /**
   * Accepts a temporary Game Center identifier. Sandbox players -- every build
   * that is not from TestFlight or the App Store -- never get a persistent one,
   * so without this a development build cannot sign in at all. Defaults to
   * false, and the server refuses the same allowance outside a local
   * deployment, so a release build cannot turn it on unilaterally.
   */
  allowNonPersistentIds?: boolean;
  clearAccountData(): Promise<void>;
  createUuid(): string;
  deviceContext(): { locale: string; timeZone: string };
  fingerprint(teamPlayerId: string): Promise<string>;
  native: {
    fetchProof(): Promise<GameCenterIdentityVerificationItems>;
    start(): Promise<GameCenterPlayerState>;
    subscribe(listener: (state: GameCenterPlayerState) => void): RemovableSubscription;
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

export class AuthenticationCoordinator {
  private activeGeneration = 0;
  private activePlayerFingerprint: string | undefined;
  private currentState: AuthenticationState = { phase: 'STARTING' };
  private disconnectedPlayerFingerprint: string | undefined;
  private readonly listeners = new Set<AuthenticationListener>();
  private nativeSubscription: RemovableSubscription | undefined;
  private pendingFingerprint: string | undefined;
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
    this.nativeSubscription ??= this.dependencies.native.subscribe((state) => {
      void this.handleNativeState(state).catch((error: unknown) =>
        this.handleAuthenticationFailure(error),
      );
    });
    this.publish({ phase: 'AUTHENTICATING' });
    try {
      await this.handleNativeState(await this.dependencies.native.start());
    } catch (error) {
      await this.handleAuthenticationFailure(error);
    }
  }

  stop(): void {
    this.activeGeneration += 1;
    this.nativeSubscription?.remove();
    this.nativeSubscription = undefined;
    this.cancelRefreshTimer();
  }

  async retry(): Promise<void> {
    this.disconnectedPlayerFingerprint = undefined;
    this.publish({ phase: 'AUTHENTICATING' });
    try {
      await this.handleNativeState(await this.dependencies.native.start());
    } catch (error) {
      await this.handleAuthenticationFailure(error);
    }
  }

  async disconnect(): Promise<void> {
    const disconnectedPlayerFingerprint = this.activePlayerFingerprint;
    const accessToken = this.currentState.session?.accessToken;
    if (accessToken !== undefined) {
      try {
        await this.dependencies.api.logout(accessToken);
      } catch {
        // Local token removal completes logout even if the family was already invalid.
      }
    }
    await this.invalidateAccount();
    this.disconnectedPlayerFingerprint = disconnectedPlayerFingerprint;
    this.publish({ phase: 'GAME_CENTER_BLOCKED' });
  }

  /**
   * Replaces the account snapshot after the player changes something the
   * server owns, such as a preference or the account time zone, without
   * disturbing the tokens or the refresh timer.
   */
  applyAccountUpdate(user: MeResponse['user']): void {
    const session = this.currentState.session;
    if (session === undefined || this.currentState.phase !== 'AUTHENTICATED') {
      return;
    }
    this.publish({ phase: 'AUTHENTICATED', session: { ...session, user } });
  }

  /**
   * Forces a fresh Game Center proof exchange. Deletion requires a proof from
   * the last 300 seconds and an ordinary refresh deliberately preserves the
   * original sign-in time, so the stored session cannot satisfy the gate.
   */
  async reauthenticate(): Promise<boolean> {
    const nativeState = await this.dependencies.native.start();
    if (
      !nativeState.isAuthenticated ||
      nativeState.teamPlayerId === undefined ||
      !nativeState.scopedIdsPersistent
    ) {
      return false;
    }
    const playerFingerprint = await this.dependencies.fingerprint(nativeState.teamPlayerId);
    if (this.activePlayerFingerprint !== playerFingerprint) {
      return false;
    }
    const generation = ++this.activeGeneration;
    try {
      await this.exchangeProof(nativeState, playerFingerprint, generation);
    } catch {
      return false;
    }
    return this.currentState.phase === 'AUTHENTICATED';
  }

  /**
   * Deletion revokes every session at the moment it commits, so the client
   * drops local data immediately. The scoped status and cancellation exchange
   * is issued by authenticating again, not by the request itself, so it is
   * absent here until the player signs in during the processing period.
   */
  async enterDeletionPending(deletionManagement?: DeletionManagement): Promise<void> {
    await this.invalidateAccount();
    this.publish({
      ...(deletionManagement === undefined ? {} : { deletionManagement }),
      phase: 'DELETION_PENDING',
    });
  }

  /**
   * Adopts the session the cancellation endpoint hands back, so a restored
   * account does not need a second Game Center proof exchange.
   */
  async resumeAfterDeletionCancelled(response: GameCenterAuthResponse): Promise<void> {
    const nativeState = await this.dependencies.native.start();
    if (!nativeState.isAuthenticated || nativeState.teamPlayerId === undefined) {
      this.publish({ phase: 'GAME_CENTER_BLOCKED' });
      return;
    }
    const playerFingerprint = await this.dependencies.fingerprint(nativeState.teamPlayerId);
    this.activePlayerFingerprint = playerFingerprint;
    this.disconnectedPlayerFingerprint = undefined;
    const generation = ++this.activeGeneration;
    await this.establishSession(
      nativeState.alias ?? 'Game Center player',
      playerFingerprint,
      { session: response.session },
      { user: response.user, bootstrap: response.bootstrap },
      generation,
    );
  }

  async handleNativeState(nativeState: GameCenterPlayerState): Promise<void> {
    if (nativeState.status === 'UNSUPPORTED') {
      await this.invalidateAccount();
      this.publish({ phase: 'UNSUPPORTED' });
      return;
    }
    if (nativeState.status === 'AUTHENTICATING' || nativeState.status === 'PRESENTING') {
      this.publish({ phase: 'AUTHENTICATING' });
      return;
    }
    if (
      !nativeState.isAuthenticated ||
      nativeState.teamPlayerId === undefined ||
      nativeState.gamePlayerId === undefined ||
      nativeState.alias === undefined
    ) {
      await this.invalidateAccount();
      this.publish({ phase: 'GAME_CENTER_BLOCKED' });
      return;
    }
    if (!nativeState.scopedIdsPersistent && !this.dependencies.allowNonPersistentIds) {
      await this.invalidateAccount();
      this.publish({ phase: 'NONPERSISTENT_ID' });
      return;
    }

    const playerFingerprint = await this.dependencies.fingerprint(nativeState.teamPlayerId);
    if (this.disconnectedPlayerFingerprint === playerFingerprint) {
      this.publish({ phase: 'GAME_CENTER_BLOCKED' });
      return;
    }
    if (
      this.disconnectedPlayerFingerprint !== undefined &&
      this.disconnectedPlayerFingerprint !== playerFingerprint
    ) {
      this.disconnectedPlayerFingerprint = undefined;
    }
    if (this.pendingFingerprint === playerFingerprint) {
      return;
    }
    if (
      this.activePlayerFingerprint !== undefined &&
      this.activePlayerFingerprint !== playerFingerprint
    ) {
      await this.invalidateAccount();
    }
    this.activePlayerFingerprint = playerFingerprint;
    this.pendingFingerprint = playerFingerprint;
    const generation = ++this.activeGeneration;
    this.publish({ phase: 'AUTHENTICATING' });
    try {
      const restored = await this.tryRestoreSession(
        nativeState.alias,
        playerFingerprint,
        generation,
      );
      if (!restored) {
        await this.exchangeProof(nativeState, playerFingerprint, generation);
      }
    } catch (error) {
      if (generation === this.activeGeneration) {
        await this.handleAuthenticationFailure(error);
      }
    } finally {
      if (this.pendingFingerprint === playerFingerprint) {
        this.pendingFingerprint = undefined;
      }
    }
  }

  private async tryRestoreSession(
    alias: string,
    playerFingerprint: string,
    generation: number,
  ): Promise<boolean> {
    const stored = await this.dependencies.storage.load();
    if (stored?.playerFingerprint !== playerFingerprint) {
      if (stored !== undefined) {
        await this.dependencies.clearAccountData();
      }
      return false;
    }
    try {
      const device = await this.device();
      const refreshed = await this.dependencies.api.refresh(
        stored.refreshToken,
        device,
        await this.refreshIdempotencyKey(stored),
      );
      await this.dependencies.storage.save({
        ...stored,
        refreshIdempotencyKey: this.dependencies.createUuid(),
        refreshToken: refreshed.session.refreshToken,
      });
      const bootstrap = await this.dependencies.api.bootstrap(refreshed.session.accessToken);
      if (bootstrap.user.id !== stored.userId) {
        await this.dependencies.clearAccountData();
        return false;
      }
      await this.establishSession(alias, playerFingerprint, refreshed, bootstrap, generation);
      return true;
    } catch (error) {
      if (!invalidatesStoredAccount(error)) {
        // Not proof that the stored session is gone. Surface it and let the
        // player retry with their archive intact rather than trading a
        // transient server failure for permanent local data loss.
        throw error;
      }
      await this.dependencies.clearAccountData();
      return false;
    }
  }

  private async exchangeProof(
    nativeState: GameCenterPlayerState,
    playerFingerprint: string,
    generation: number,
  ): Promise<void> {
    const proof = await this.dependencies.native.fetchProof();
    const deviceContext = this.dependencies.deviceContext();
    const response = await this.dependencies.api.authenticate(
      gameCenterAuthRequestSchema.parse({
        proof: {
          teamPlayerId: proof.teamPlayerId,
          gamePlayerId: proof.gamePlayerId,
          bundleId: proof.bundleId,
          publicKeyUrl: proof.publicKeyUrl,
          signatureBase64: proof.signatureBase64,
          saltBase64: proof.saltBase64,
          timestamp: proof.timestamp,
        },
        scopedIdsPersistent: proof.scopedIdsPersistent,
        alias: proof.alias,
        restrictions: proof.restrictions,
        reportedDeviceLocale: deviceContext.locale,
        reportedDeviceTimeZone: deviceContext.timeZone,
        device: await this.device(),
      }),
    );
    await this.establishSession(
      nativeState.alias ?? proof.alias,
      playerFingerprint,
      { session: response.session },
      { user: response.user, bootstrap: response.bootstrap },
      generation,
    );
  }

  private async establishSession(
    alias: string,
    playerFingerprint: string,
    tokens: RefreshSessionResponse,
    account: MeResponse,
    generation: number,
  ): Promise<void> {
    if (generation !== this.activeGeneration) {
      return;
    }
    await this.dependencies.storage.save({
      appAccountToken: account.bootstrap.appAccountToken,
      playerFingerprint,
      // A rotation retires the old token, so the next attempt spends a new one
      // and needs its own key.
      refreshIdempotencyKey: this.dependencies.createUuid(),
      refreshToken: tokens.session.refreshToken,
      userId: account.user.id,
    });
    if (generation !== this.activeGeneration) {
      await this.invalidateAccount();
      return;
    }
    const session: AuthenticatedMobileSession = {
      accessToken: tokens.session.accessToken,
      accessTokenExpiresAt: tokens.session.accessTokenExpiresAt,
      alias,
      bootstrap: account.bootstrap,
      playerFingerprint,
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
    const generation = ++this.activeGeneration;
    try {
      const stored = await this.dependencies.storage.load();
      if (stored?.playerFingerprint !== session.playerFingerprint) {
        throw new MobileApiError({
          code: 'AUTH_REQUIRED',
          message: 'The local refresh session is unavailable.',
          retryable: false,
        });
      }
      const refreshed = await this.dependencies.api.refresh(
        stored.refreshToken,
        await this.device(),
        await this.refreshIdempotencyKey(stored),
      );
      await this.establishSession(
        session.alias,
        session.playerFingerprint,
        refreshed,
        { user: session.user, bootstrap: session.bootstrap },
        generation,
      );
    } catch (error) {
      if (generation === this.activeGeneration) {
        await this.handleAuthenticationFailure(error);
      }
    }
  }

  /**
   * The key presented for `stored.refreshToken`. It is persisted before it is
   * ever sent, so an attempt that dies mid-flight -- a crash, a timeout, a
   * backgrounded app -- retries under the same key and is answered from the
   * server's replay receipt instead of revoking the session family.
   */
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
    const failureDetail = describeFailure(error);
    if (error instanceof MobileApiError && error.code === 'NETWORK_UNAVAILABLE') {
      this.cancelRefreshTimer();
      this.publish({ failureDetail, phase: 'ERROR' });
      return;
    }
    if (invalidatesStoredAccount(error)) {
      await this.invalidateAccount();
    } else {
      // The live session is dropped either way, but the stored account stays.
      this.discardActiveSession();
    }
    if (error instanceof MobileApiError) {
      if (error.code === 'ACCOUNT_DELETION_PENDING') {
        // The scoped exchange rides on the authentication error, so status and
        // cancellation stay reachable without restoring application access.
        const management = deletionManagementSchema.safeParse(error.details);
        this.publish({
          ...(management.success ? { deletionManagement: management.data } : {}),
          phase: 'DELETION_PENDING',
        });
        return;
      }
      if (error.code === 'ACCOUNT_PURGED') {
        this.publish({ phase: 'PURGED' });
        return;
      }
      if (error.code === 'GAME_CENTER_ID_NOT_PERSISTENT') {
        this.publish({ failureDetail, phase: 'NONPERSISTENT_ID' });
        return;
      }
    }
    this.publish({ failureDetail, phase: 'ERROR' });
  }

  /** Drops the live session without touching anything stored on the device. */
  private discardActiveSession(): void {
    this.activeGeneration += 1;
    this.activePlayerFingerprint = undefined;
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
