import { createHash, randomUUID } from 'node:crypto';

import { PrismaPg } from '@prisma/adapter-pg';
import { type GameCenterAuthRequest } from '@fortuneness/api-contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AccessTokenService } from '../auth/access-token.js';
import { AccountBootstrapService } from '../auth/account-bootstrap.js';
import {
  GameCenterLoginError,
  GameCenterLoginService,
  type GameCenterIdentityVerifier,
} from '../auth/game-center-login.js';
import { type VerifiedGameCenterIdentity } from '../auth/game-center-proof.js';
import { LogoutSessionError, LogoutSessionService } from '../auth/logout-session.js';
import { RefreshSessionError, RefreshSessionService } from '../auth/refresh-session.js';
import { createTestApiEnvironment } from '../config/environment.fixture.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { mapDatabaseError } from './errors.js';

const databaseUrl = process.env['TEST_DATABASE_URL'];
if (databaseUrl === undefined || databaseUrl.trim().length === 0) {
  throw new Error('TEST_DATABASE_URL is required for database integration tests.');
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`;
});

afterAll(async () => {
  await prisma.$disconnect();
});

async function createDrawFixture() {
  const now = new Date();
  const user = await prisma.user.create({ data: { accountTimeZone: 'UTC' } });
  const period = await prisma.allowancePeriod.create({
    data: {
      userId: user.id,
      sequence: 1n,
      startedAt: new Date(now.getTime() - 1_000),
      resetAt: new Date(now.getTime() + 86_400_000),
      timeZoneSnapshot: 'UTC',
    },
  });
  const template = await prisma.fortuneTemplate.findFirstOrThrow({
    where: { active: true },
    include: { card: true },
  });

  return {
    data: {
      userId: user.id,
      cardKey: template.cardKey,
      templateId: template.id,
      allowancePeriodId: period.id,
      allowanceSource: 'FREE_DAILY' as const,
      intention: template.intention,
      orientation: template.orientation,
      resolvedLocale: template.locale,
      sequence: 1n,
      cardDisplayNumber: template.card.displayNumber,
      cardNameSnapshot: template.card.nameEn,
      illustrationAltSnapshot: template.card.illustrationAltEn,
      headlineSnapshot: template.headline,
      messageSnapshot: template.message,
      gentleActionSnapshot: template.gentleAction,
      affirmationSnapshot: template.affirmation,
      contentVersionSnapshot: template.contentVersion,
      issuedAt: now,
      viewedAt: now,
      clientIdempotencyKey: randomUUID(),
      requestHash: 'a'.repeat(64),
    },
  };
}

async function createPurchaseFixture(transactionId = `tx-${randomUUID()}`) {
  const financialSubject = await prisma.financialSubject.create({ data: {} });
  const purchase = await prisma.iapTransaction.create({
    data: {
      environment: 'XCODE',
      transactionId,
      originalTransactionId: `original-${randomUUID()}`,
      productId: 'app.fortuneness.credits.10',
      productType: 'CONSUMABLE',
      financialSubjectId: financialSubject.id,
      purchaseAt: new Date(),
      normalizedPayload: { test: true },
      jwsHash: 'b'.repeat(64),
    },
  });
  return { financialSubject, purchase };
}

function createLoginRequest(marker: string): GameCenterAuthRequest {
  return {
    proof: {
      teamPlayerId: 'raw-team-player-never-persisted',
      gamePlayerId: 'raw-game-player-never-persisted',
      bundleId: 'app.fortuneness.test',
      publicKeyUrl: 'https://static.gc.apple.com/public-key.cer',
      signatureBase64: Buffer.from(`signature-${marker}`).toString('base64'),
      saltBase64: Buffer.from(`salt-${marker}`).toString('base64'),
      timestamp: String(Date.now()),
    },
    scopedIdsPersistent: true,
    alias: 'Test Player',
    restrictions: {
      isUnderage: false,
      isMultiplayerGamingRestricted: false,
      isPersonalizedCommunicationRestricted: false,
    },
    reportedDeviceLocale: 'en-US',
    reportedDeviceTimeZone: 'Europe/Kyiv',
    device: { id: randomUUID(), description: 'Integration test device' },
  };
}

function createVerifiedIdentity(
  marker: string,
  currentDigest: string,
  candidates: VerifiedGameCenterIdentity['identityCandidates'] = [
    { keyVersion: 'v1', digest: currentDigest },
  ],
): VerifiedGameCenterIdentity {
  const authenticatedAt = new Date();
  return {
    authenticatedAt,
    currentIdentity: { keyVersion: 'v1', digest: currentDigest },
    identityCandidates: candidates,
    proofExpiresAt: new Date(authenticatedAt.getTime() + 900_000),
    proofFingerprint: createHash('sha256').update(`proof-${marker}`).digest('hex'),
    secondaryMigrationIdentity: {
      keyVersion: 'v1',
      digest: createHash('sha256').update(`secondary-${marker}`).digest('hex'),
    },
  };
}

describe('PostgreSQL integrity', { concurrent: false }, () => {
  it('rejects a replayed verified Game Center proof fingerprint', async () => {
    const fingerprint = 'c'.repeat(64);
    await prisma.identityProofReplay.create({
      data: { fingerprint, expiresAt: new Date(Date.now() + 900_000) },
    });

    await expect(
      prisma.identityProofReplay.create({
        data: { fingerprint, expiresAt: new Date(Date.now() + 900_000) },
      }),
    ).rejects.toSatisfy((error: unknown) => mapDatabaseError(error)?.kind === 'UNIQUE_CONSTRAINT');
  });

  it('converges concurrent first logins and rotates an old identity digest', async () => {
    const environment = createTestApiEnvironment().authentication;
    const identityDigest = createHash('sha256').update(randomUUID()).digest('hex');
    const verifiedByMarker = new Map([
      ['first', createVerifiedIdentity('first', identityDigest)],
      ['second', createVerifiedIdentity('second', identityDigest)],
    ]);
    const proofVerifier: GameCenterIdentityVerifier = {
      verify: (request) => {
        const marker = Buffer.from(request.proof.signatureBase64, 'base64')
          .toString('utf8')
          .replace('signature-', '');
        const verified = verifiedByMarker.get(marker);
        if (verified === undefined) {
          throw new Error('Unexpected integration proof marker.');
        }
        return Promise.resolve(verified);
      },
    };
    const accessTokens = new AccessTokenService(environment);
    const login = new GameCenterLoginService({
      accessTokens,
      client: prisma,
      environment,
      proofVerifier,
    });
    const firstRequest = createLoginRequest('first');
    const secondRequest = createLoginRequest('second');
    const [first, second] = await Promise.all([
      login.login(firstRequest),
      login.login(secondRequest),
    ]);

    expect(second.user.id).toBe(first.user.id);
    expect(second.bootstrap.appAccountToken).toBe(first.bootstrap.appAccountToken);
    expect(second.session.refreshToken).not.toBe(first.session.refreshToken);
    await expect(login.login(firstRequest)).rejects.toSatisfy(
      (error: unknown) => error instanceof GameCenterLoginError && error.code === 'PROOF_REPLAY',
    );
    await expect(
      prisma.externalIdentity.count({
        where: { provider: 'GAME_CENTER', keyVersion: 'v1', subjectDigest: identityDigest },
      }),
    ).resolves.toBe(1);
    await expect(prisma.sessionFamily.count({ where: { userId: first.user.id } })).resolves.toBe(2);
    await expect(
      prisma.appAccountTokenBinding.count({
        where: { financialSubject: { activeUser: { id: first.user.id } }, validTo: null },
      }),
    ).resolves.toBe(1);

    const previousDigest = createHash('sha256').update(randomUUID()).digest('hex');
    const rotationMarker = `rotation-${randomUUID()}`;
    verifiedByMarker.set(rotationMarker, {
      ...createVerifiedIdentity(rotationMarker, identityDigest, [
        { keyVersion: 'v1', digest: identityDigest },
        { keyVersion: 'v0', digest: previousDigest },
      ]),
    });
    await prisma.externalIdentity.updateMany({
      where: { userId: first.user.id, provider: 'GAME_CENTER' },
      data: { keyVersion: 'v0', subjectDigest: previousDigest },
    });
    const rotated = await login.login(createLoginRequest(rotationMarker));
    expect(rotated.user.id).toBe(first.user.id);
    await expect(
      prisma.externalIdentity.findFirstOrThrow({
        where: { userId: first.user.id, provider: 'GAME_CENTER' },
      }),
    ).resolves.toMatchObject({ keyVersion: 'v1', subjectDigest: identityDigest });

    const refresh = new RefreshSessionService({ accessTokens, client: prisma, environment });
    const firstRefreshKey = randomUUID();
    const firstReplacement = await refresh.refresh(
      { refreshToken: first.session.refreshToken, device: firstRequest.device },
      firstRefreshKey,
    );
    await expect(
      refresh.refresh(
        { refreshToken: firstReplacement.session.refreshToken, device: firstRequest.device },
        firstRefreshKey,
      ),
    ).resolves.toMatchObject({ session: { authTime: first.session.authTime } });

    const concurrentRefreshKey = randomUUID();
    const secondRefreshRequest = {
      refreshToken: second.session.refreshToken,
      device: secondRequest.device,
    };
    const [concurrentFirst, concurrentRetry] = await Promise.all([
      refresh.refresh(secondRefreshRequest, concurrentRefreshKey),
      refresh.refresh(secondRefreshRequest, concurrentRefreshKey),
    ]);
    expect(concurrentRetry).toEqual(concurrentFirst);
    const secondFamily = await accessTokens.verify(second.session.accessToken);
    await expect(refresh.refresh(secondRefreshRequest, randomUUID())).rejects.toSatisfy(
      (error: unknown) => error instanceof RefreshSessionError && error.code === 'AUTH_REQUIRED',
    );
    await expect(
      prisma.sessionFamily.findUniqueOrThrow({ where: { id: secondFamily.sessionFamilyId } }),
    ).resolves.toMatchObject({ revocationReason: 'REFRESH_REUSE' });

    const rotatedAuthentication = await accessTokens.verify(rotated.session.accessToken);
    const logout = new LogoutSessionService(prisma);
    const logoutContext = {
      ...rotatedAuthentication,
      authTime: new Date(rotatedAuthentication.authTimeSeconds * 1_000),
    };
    const bootstrap = await new AccountBootstrapService(prisma, environment).get(logoutContext);
    expect(bootstrap.bootstrap.appAccountToken).toBe(rotated.bootstrap.appAccountToken);
    await logout.logout(logoutContext);
    await expect(logout.logout(logoutContext)).rejects.toSatisfy(
      (error: unknown) => error instanceof LogoutSessionError && error.code === 'AUTH_REQUIRED',
    );
    await expect(
      prisma.sessionFamily.findUniqueOrThrow({
        where: { id: rotatedAuthentication.sessionFamilyId },
      }),
    ).resolves.toMatchObject({ revocationReason: 'LOGOUT' });
  });

  it('rejects a duplicate user draw idempotency record', async () => {
    const fixture = await createDrawFixture();
    await prisma.fortuneDraw.create({ data: fixture.data });

    const duplicate = prisma.fortuneDraw.create({
      data: { ...fixture.data, sequence: 2n },
    });
    await expect(duplicate).rejects.toSatisfy(
      (error: unknown) => mapDatabaseError(error)?.kind === 'UNIQUE_CONSTRAINT',
    );
  });

  it('rejects a duplicate environment-scoped Apple transaction', async () => {
    const transactionId = `tx-${randomUUID()}`;
    await createPurchaseFixture(transactionId);

    const duplicate = createPurchaseFixture(transactionId);
    await expect(duplicate).rejects.toSatisfy(
      (error: unknown) => mapDatabaseError(error)?.kind === 'UNIQUE_CONSTRAINT',
    );
  });

  it('rejects duplicate ledger effects and mutation of committed ledger history', async () => {
    const { financialSubject, purchase } = await createPurchaseFixture();
    const grant = await prisma.packCreditGrant.create({
      data: {
        financialSubjectId: financialSubject.id,
        purchaseTransactionId: purchase.id,
      },
    });
    const effectKey = `purchase:${purchase.id}`;
    const ledgerEntry = await prisma.creditLedgerEntry.create({
      data: {
        financialSubjectId: financialSubject.id,
        delta: 10,
        balanceAfter: 10,
        reason: 'PACK_PURCHASE',
        grantId: grant.id,
        purchaseTransactionId: purchase.id,
        effectKey,
      },
    });

    const duplicate = prisma.creditLedgerEntry.create({
      data: {
        financialSubjectId: financialSubject.id,
        delta: 10,
        balanceAfter: 20,
        reason: 'PACK_PURCHASE',
        grantId: grant.id,
        purchaseTransactionId: purchase.id,
        effectKey,
      },
    });
    await expect(duplicate).rejects.toSatisfy(
      (error: unknown) => mapDatabaseError(error)?.kind === 'UNIQUE_CONSTRAINT',
    );
    await expect(
      prisma.creditLedgerEntry.update({
        where: { id: ledgerEntry.id },
        data: { balanceAfter: 11 },
      }),
    ).rejects.toSatisfy((error: unknown) => mapDatabaseError(error)?.kind === 'CHECK_CONSTRAINT');
  });
});
