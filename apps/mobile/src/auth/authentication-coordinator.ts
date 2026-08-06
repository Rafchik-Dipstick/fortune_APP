import {
  gameCenterAuthRequestSchema,
  type AuthDevice,
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
  phase: AuthenticationPhase;
  session?: AuthenticatedMobileSession;
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
    if (!nativeState.scopedIdsPersistent) {
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
        this.dependencies.createUuid(),
      );
      await this.dependencies.storage.save({
        ...stored,
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
      if (error instanceof MobileApiError && error.code === 'NETWORK_UNAVAILABLE') {
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
        this.dependencies.createUuid(),
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

  private async device(): Promise<AuthDevice> {
    return {
      id: await this.dependencies.storage.getDeviceId(() => this.dependencies.createUuid()),
    };
  }

  private async handleAuthenticationFailure(error: unknown): Promise<void> {
    if (error instanceof MobileApiError) {
      if (error.code === 'NETWORK_UNAVAILABLE') {
        this.cancelRefreshTimer();
        this.publish({ phase: 'ERROR' });
        return;
      }
      await this.invalidateAccount();
      if (error.code === 'ACCOUNT_DELETION_PENDING') {
        this.publish({ phase: 'DELETION_PENDING' });
        return;
      }
      if (error.code === 'ACCOUNT_PURGED') {
        this.publish({ phase: 'PURGED' });
        return;
      }
      if (error.code === 'GAME_CENTER_ID_NOT_PERSISTENT') {
        this.publish({ phase: 'NONPERSISTENT_ID' });
        return;
      }
    } else {
      await this.invalidateAccount();
    }
    this.publish({ phase: 'ERROR' });
  }

  private async invalidateAccount(): Promise<void> {
    this.activeGeneration += 1;
    this.activePlayerFingerprint = undefined;
    this.cancelRefreshTimer();
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
