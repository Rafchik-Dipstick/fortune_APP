import { randomUUID } from 'node:crypto';

import {
  deletionManagementSchema,
  gameCenterAuthResponseSchema,
  type AuthenticatedUser,
  type DeletionManagement,
  type GameCenterAuthRequest,
  type GameCenterAuthResponse,
} from '@fortuneness/api-contracts';

import { type AuthenticationEnvironment } from '../config/environment.js';
import { type Prisma, type PrismaClient } from '../generated/prisma/client.js';
import { DatabaseError } from '../db/errors.js';
import {
  lockFinancialSubjectForUpdate,
  lockUserForUpdate,
  runReadCommittedTransaction,
} from '../db/transactions.js';
import { canonicalizeIanaTimeZone } from '../fortune/account-day.js';
import { resolveCurrentPurchaseToken } from '../iap/purchase-token.js';
import { createCurrentHmacDigest, createOpaqueToken } from '../security/crypto.js';
import { type DeletionManagementTokenService } from '../account/deletion-management-token.js';
import { type AccessTokenService } from './access-token.js';
import { type VerifiedGameCenterIdentity } from './game-center-proof.js';

const millisecondsPerDay = 86_400_000;
const refreshTokenDigestPrefix = 'refresh-token:';
const deviceDigestPrefix = 'session-device:';

export interface GameCenterIdentityVerifier {
  verify(request: GameCenterAuthRequest): Promise<VerifiedGameCenterIdentity>;
}

export type GameCenterLoginErrorCode =
  | 'ACCOUNT_BLOCKED'
  | 'ACCOUNT_DELETION_PENDING'
  | 'ACCOUNT_PURGED'
  | 'IDENTITY_CONFLICT'
  | 'PROOF_REPLAY'
  | 'TIME_ZONE_INVALID';

export class GameCenterLoginError extends Error {
  readonly code: GameCenterLoginErrorCode;
  /**
   * Present only for `ACCOUNT_DELETION_PENDING`. Authentication during the
   * processing period returns the scoped exchange rather than a session, so
   * the player can see status or cancel without regaining application access
   * (spec section 6.3).
   */
  readonly deletionManagement: DeletionManagement | undefined;

  constructor(
    code: GameCenterLoginErrorCode,
    cause?: unknown,
    deletionManagement?: DeletionManagement,
  ) {
    super(`Game Center login failed: ${code}.`, { cause });
    this.name = 'GameCenterLoginError';
    this.code = code;
    this.deletionManagement = deletionManagement;
  }
}

interface LoginDependencies {
  accessTokens: AccessTokenService;
  client: PrismaClient;
  deletionManagementTokens?: DeletionManagementTokenService;
  environment: AuthenticationEnvironment;
  now?: () => Date;
  opaqueTokenFactory?: () => string;
  proofVerifier: GameCenterIdentityVerifier;
  uuidFactory?: () => string;
}

type FullUser = Prisma.UserGetPayload<Record<string, never>>;

export function serializeAuthenticatedUser(user: FullUser): AuthenticatedUser {
  return {
    id: user.id,
    status: user.status,
    resolvedLocale: 'en',
    accountTimeZone: user.accountTimeZone,
    pendingTimeZone: user.pendingTimeZone,
    timeZoneEffectiveAt: user.timeZoneEffectiveAt?.toISOString() ?? null,
    nextTimeZoneChangeEligibleAt: user.nextTimeZoneChangeEligibleAt?.toISOString() ?? null,
    onboardingCompletedAt: user.onboardingCompletedAt?.toISOString() ?? null,
    preferences: {
      reminderEnabled: user.reminderEnabled,
      reminderLocalMinutes: user.reminderLocalMinutes,
      soundEnabled: user.soundEnabled,
      hapticsEnabled: user.hapticsEnabled,
      reduceMotionPreferred: user.reduceMotionPreferred,
    },
  };
}

function assertAccountStatusAllowsSession(user: FullUser): void {
  switch (user.status) {
    case 'ACTIVE':
      return;
    case 'BLOCKED':
      throw new GameCenterLoginError('ACCOUNT_BLOCKED');
    case 'DELETION_PENDING':
      throw new GameCenterLoginError('ACCOUNT_DELETION_PENDING');
    case 'PURGED':
      throw new GameCenterLoginError('ACCOUNT_PURGED');
  }
}

export class GameCenterLoginService {
  private readonly accessTokens: AccessTokenService;
  private readonly client: PrismaClient;
  private readonly deletionManagementTokens: DeletionManagementTokenService | undefined;
  private readonly environment: AuthenticationEnvironment;
  private readonly now: () => Date;
  private readonly opaqueTokenFactory: () => string;
  private readonly proofVerifier: GameCenterIdentityVerifier;
  private readonly uuidFactory: () => string;

  constructor(dependencies: LoginDependencies) {
    this.accessTokens = dependencies.accessTokens;
    this.client = dependencies.client;
    this.deletionManagementTokens = dependencies.deletionManagementTokens;
    this.environment = dependencies.environment;
    this.now = dependencies.now ?? (() => new Date());
    this.opaqueTokenFactory = dependencies.opaqueTokenFactory ?? createOpaqueToken;
    this.proofVerifier = dependencies.proofVerifier;
    this.uuidFactory = dependencies.uuidFactory ?? randomUUID;
  }

  async login(request: GameCenterAuthRequest): Promise<GameCenterAuthResponse> {
    const verifiedIdentity = await this.proofVerifier.verify(request);
    let accountTimeZone: string;
    try {
      accountTimeZone = canonicalizeIanaTimeZone(request.reportedDeviceTimeZone);
    } catch (error) {
      throw new GameCenterLoginError('TIME_ZONE_INVALID', error);
    }

    try {
      return await this.commitLogin(request, verifiedIdentity, accountTimeZone);
    } catch (error) {
      if (error instanceof DatabaseError && error.kind === 'UNIQUE_CONSTRAINT') {
        return this.commitLogin(request, verifiedIdentity, accountTimeZone);
      }
      throw error;
    }
  }

  private async commitLogin(
    request: GameCenterAuthRequest,
    verifiedIdentity: VerifiedGameCenterIdentity,
    accountTimeZone: string,
  ): Promise<GameCenterAuthResponse> {
    return runReadCommittedTransaction(this.client, async (transaction) => {
      const now = this.now();
      await this.reserveProof(transaction, verifiedIdentity, now);
      const user = await this.resolveUser(
        transaction,
        verifiedIdentity,
        accountTimeZone,
        request.reportedDeviceLocale,
        now,
      );
      await this.assertAccountCanCreateNormalSession(
        transaction,
        user,
        verifiedIdentity.authenticatedAt,
      );

      const appAccountToken = await this.loadOrCreatePurchaseToken(transaction, user, now);
      const refreshToken = this.opaqueTokenFactory();
      const refreshTokenDigest = createCurrentHmacDigest(
        `${refreshTokenDigestPrefix}${refreshToken}`,
        this.environment.refreshTokenHmacKeys,
      );
      const deviceDigest = createCurrentHmacDigest(
        `${deviceDigestPrefix}${request.device.id}`,
        this.environment.refreshTokenHmacKeys,
      );
      const refreshTokenExpiresAt = new Date(
        now.getTime() + this.environment.refreshTokenTtlDays * millisecondsPerDay,
      );
      const family = await transaction.sessionFamily.create({
        data: {
          userId: user.id,
          sessionVersion: user.sessionVersion,
          gameCenterAuthenticatedAt: verifiedIdentity.authenticatedAt,
          issuedAt: now,
          expiresAt: refreshTokenExpiresAt,
          refreshTokens: {
            create: {
              tokenHash: refreshTokenDigest.digest,
              expiresAt: refreshTokenExpiresAt,
              deviceIdHash: deviceDigest.digest,
              ...(request.device.description === undefined
                ? {}
                : { deviceDescription: request.device.description }),
              createdAt: now,
            },
          },
        },
      });
      const access = await this.accessTokens.issue({
        authTime: verifiedIdentity.authenticatedAt,
        sessionFamilyId: family.id,
        sessionVersion: user.sessionVersion,
        userId: user.id,
      });

      return gameCenterAuthResponseSchema.parse({
        user: serializeAuthenticatedUser(user),
        session: {
          accessToken: access.accessToken,
          refreshToken,
          accessTokenExpiresAt: access.expiresAt.toISOString(),
          refreshTokenExpiresAt: refreshTokenExpiresAt.toISOString(),
          authTime: verifiedIdentity.authenticatedAt.toISOString(),
        },
        bootstrap: {
          serverTime: now.toISOString(),
          reportedDeviceLocale: request.reportedDeviceLocale,
          reportedDeviceTimeZone: request.reportedDeviceTimeZone,
          appAccountToken,
        },
      });
    });
  }

  /**
   * Status gate for a normal session. A pending deletion is not simply
   * refused: the player is handed a scoped token so they can read the status
   * or cancel, which is the only route back into the account.
   */
  private async assertAccountCanCreateNormalSession(
    transaction: Prisma.TransactionClient,
    user: FullUser,
    authenticatedAt: Date,
  ): Promise<void> {
    if (user.status !== 'DELETION_PENDING' || this.deletionManagementTokens === undefined) {
      assertAccountStatusAllowsSession(user);
      return;
    }

    const request = await transaction.accountDeletionRequest.findFirst({
      where: { userId: user.id, status: 'PENDING' },
      orderBy: { requestedAt: 'desc' },
    });
    if (request === null) {
      assertAccountStatusAllowsSession(user);
      return;
    }
    const issued = await this.deletionManagementTokens.issue(user.id, authenticatedAt);
    throw new GameCenterLoginError(
      'ACCOUNT_DELETION_PENDING',
      undefined,
      deletionManagementSchema.parse({
        deletionManagementToken: issued.token,
        expiresAt: issued.expiresAt.toISOString(),
        deletion: {
          status: request.status,
          requestedAt: request.requestedAt.toISOString(),
          purgeAt: request.purgeAt.toISOString(),
          cancelledAt: request.cancelledAt?.toISOString() ?? null,
        },
      }),
    );
  }

  /**
   * Issues a fresh session after a cancelled deletion. The Game Center proof
   * that produced the deletion-management token is reused as the authoritative
   * `auth_time`, so cancellation cannot manufacture a newer proof than the
   * player actually presented.
   */
  async issueRestoredSession(options: {
    authenticatedAt: Date;
    userId: string;
  }): Promise<GameCenterAuthResponse> {
    return runReadCommittedTransaction(this.client, async (transaction) => {
      const now = this.now();
      const user = await transaction.user.findUniqueOrThrow({ where: { id: options.userId } });
      assertAccountStatusAllowsSession(user);

      const appAccountToken = await this.loadOrCreatePurchaseToken(transaction, user, now);
      const refreshToken = this.opaqueTokenFactory();
      const refreshTokenDigest = createCurrentHmacDigest(
        `${refreshTokenDigestPrefix}${refreshToken}`,
        this.environment.refreshTokenHmacKeys,
      );
      const refreshTokenExpiresAt = new Date(
        now.getTime() + this.environment.refreshTokenTtlDays * millisecondsPerDay,
      );
      const family = await transaction.sessionFamily.create({
        data: {
          userId: user.id,
          sessionVersion: user.sessionVersion,
          gameCenterAuthenticatedAt: options.authenticatedAt,
          issuedAt: now,
          expiresAt: refreshTokenExpiresAt,
          refreshTokens: {
            create: {
              tokenHash: refreshTokenDigest.digest,
              expiresAt: refreshTokenExpiresAt,
              createdAt: now,
            },
          },
        },
      });
      const access = await this.accessTokens.issue({
        authTime: options.authenticatedAt,
        sessionFamilyId: family.id,
        sessionVersion: user.sessionVersion,
        userId: user.id,
      });

      return gameCenterAuthResponseSchema.parse({
        user: serializeAuthenticatedUser(user),
        session: {
          accessToken: access.accessToken,
          refreshToken,
          accessTokenExpiresAt: access.expiresAt.toISOString(),
          refreshTokenExpiresAt: refreshTokenExpiresAt.toISOString(),
          authTime: options.authenticatedAt.toISOString(),
        },
        bootstrap: {
          serverTime: now.toISOString(),
          reportedDeviceLocale: user.resolvedLocale,
          reportedDeviceTimeZone: user.reportedDeviceTimeZone,
          appAccountToken,
        },
      });
    });
  }

  private async reserveProof(
    transaction: Prisma.TransactionClient,
    verifiedIdentity: VerifiedGameCenterIdentity,
    now: Date,
  ): Promise<void> {
    const existing = await transaction.identityProofReplay.findUnique({
      where: { fingerprint: verifiedIdentity.proofFingerprint },
    });
    if (existing !== null && existing.expiresAt > now) {
      throw new GameCenterLoginError('PROOF_REPLAY');
    }
    if (existing !== null) {
      await transaction.identityProofReplay.delete({
        where: { fingerprint: verifiedIdentity.proofFingerprint },
      });
    }
    await transaction.identityProofReplay.create({
      data: {
        fingerprint: verifiedIdentity.proofFingerprint,
        verifiedAt: now,
        expiresAt: verifiedIdentity.proofExpiresAt,
      },
    });
  }

  private async resolveUser(
    transaction: Prisma.TransactionClient,
    verifiedIdentity: VerifiedGameCenterIdentity,
    accountTimeZone: string,
    reportedDeviceLocale: string,
    now: Date,
  ): Promise<FullUser> {
    const matches = await transaction.externalIdentity.findMany({
      where: {
        provider: 'GAME_CENTER',
        OR: verifiedIdentity.identityCandidates.map((candidate) => ({
          keyVersion: candidate.keyVersion,
          subjectDigest: candidate.digest,
        })),
      },
      include: { user: true },
    });
    const matchedUserIds = new Set(matches.map((match) => match.userId));
    if (matchedUserIds.size > 1) {
      throw new GameCenterLoginError('IDENTITY_CONFLICT');
    }

    const matchedIdentity =
      matches.find(
        (match) =>
          match.keyVersion === verifiedIdentity.currentIdentity.keyVersion &&
          match.subjectDigest === verifiedIdentity.currentIdentity.digest,
      ) ?? matches[0];
    if (matchedIdentity === undefined) {
      return this.createAccount(
        transaction,
        verifiedIdentity,
        accountTimeZone,
        reportedDeviceLocale,
        now,
      );
    }

    await lockUserForUpdate(transaction, matchedIdentity.userId);
    await transaction.externalIdentity.update({
      where: { id: matchedIdentity.id },
      data: {
        keyVersion: verifiedIdentity.currentIdentity.keyVersion,
        subjectDigest: verifiedIdentity.currentIdentity.digest,
        secondaryKeyVersion: verifiedIdentity.secondaryMigrationIdentity.keyVersion,
        secondaryMigrationDigest: verifiedIdentity.secondaryMigrationIdentity.digest,
        lastAuthenticatedAt: verifiedIdentity.authenticatedAt,
      },
    });
    const duplicateIdentityIds = matches
      .filter((match) => match.id !== matchedIdentity.id)
      .map((match) => match.id);
    if (duplicateIdentityIds.length > 0) {
      await transaction.externalIdentity.deleteMany({
        where: { id: { in: duplicateIdentityIds } },
      });
    }
    return transaction.user.update({
      where: { id: matchedIdentity.userId },
      data: {
        reportedDeviceLocale,
        reportedDeviceTimeZone: accountTimeZone,
        updatedAt: now,
      },
    });
  }

  private async createAccount(
    transaction: Prisma.TransactionClient,
    verifiedIdentity: VerifiedGameCenterIdentity,
    accountTimeZone: string,
    reportedDeviceLocale: string,
    now: Date,
  ): Promise<FullUser> {
    const financialSubjectId = this.uuidFactory();
    const userId = this.uuidFactory();
    await transaction.financialSubject.create({ data: { id: financialSubjectId, createdAt: now } });
    const user = await transaction.user.create({
      data: {
        id: userId,
        accountTimeZone,
        reportedDeviceLocale,
        reportedDeviceTimeZone: accountTimeZone,
        activeFinancialSubjectId: financialSubjectId,
        createdAt: now,
        updatedAt: now,
      },
    });
    await transaction.externalIdentity.create({
      data: {
        provider: 'GAME_CENTER',
        userId,
        keyVersion: verifiedIdentity.currentIdentity.keyVersion,
        subjectDigest: verifiedIdentity.currentIdentity.digest,
        secondaryKeyVersion: verifiedIdentity.secondaryMigrationIdentity.keyVersion,
        secondaryMigrationDigest: verifiedIdentity.secondaryMigrationIdentity.digest,
        lastAuthenticatedAt: verifiedIdentity.authenticatedAt,
        createdAt: now,
        updatedAt: now,
      },
    });
    return user;
  }

  /**
   * The appAccountToken must round-trip through the one implementation that
   * Apple-event reconciliation reads back (`resolveCurrentPurchaseToken`).
   * Login previously ran its own encrypt/digest convention against the same
   * rows, which left each side unable to open bindings the other wrote.
   */
  private async loadOrCreatePurchaseToken(
    transaction: Prisma.TransactionClient,
    user: FullUser,
    now: Date,
  ): Promise<string> {
    if (user.activeFinancialSubjectId === null) {
      throw new GameCenterLoginError('IDENTITY_CONFLICT');
    }
    await lockFinancialSubjectForUpdate(transaction, user.activeFinancialSubjectId);
    const current = await resolveCurrentPurchaseToken(
      transaction,
      user.activeFinancialSubjectId,
      {
        encryptionKeys: this.environment.appAccountTokenEncryptionKeys,
        hmacKeys: this.environment.appAccountTokenHmacKeys,
      },
      now,
      this.uuidFactory,
    );
    return current.token;
  }
}
