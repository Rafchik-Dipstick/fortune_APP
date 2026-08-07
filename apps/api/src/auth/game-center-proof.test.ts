import { generateKeyPairSync, sign } from 'node:crypto';

import {
  gameCenterAuthRequestSchema,
  type GameCenterAuthRequest,
} from '@fortuneness/api-contracts';
import { describe, expect, it, vi } from 'vitest';

import { createTestApiEnvironment } from '../config/environment.fixture.js';
import { GameCenterVerificationError } from './game-center-errors.js';
import { createGameCenterSignedBytes, GameCenterProofVerifier } from './game-center-proof.js';

const authenticationEnvironment = createTestApiEnvironment().authentication;
const now = new Date('2026-08-06T10:00:00.000Z');
const timestamp = BigInt(now.getTime() - 1_000);
const salt = Buffer.from('test-salt');
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2_048 });

function createRequest(overrides: Partial<GameCenterAuthRequest> = {}): GameCenterAuthRequest {
  const signedBytes = createGameCenterSignedBytes(
    'team-player-1',
    authenticationEnvironment.bundleId,
    timestamp,
    salt,
  );
  const request = {
    proof: {
      teamPlayerId: 'team-player-1',
      gamePlayerId: 'game-player-1',
      bundleId: authenticationEnvironment.bundleId,
      publicKeyUrl: 'https://static.gc.apple.com/public-key/gc-test.cer',
      signatureBase64: sign('RSA-SHA256', signedBytes, privateKey).toString('base64'),
      saltBase64: salt.toString('base64'),
      timestamp: timestamp.toString(),
    },
    scopedIdsPersistent: true,
    alias: 'Stargazer',
    restrictions: {
      isUnderage: false,
      isMultiplayerGamingRestricted: false,
      isPersonalizedCommunicationRestricted: false,
    },
    reportedDeviceLocale: 'en-US',
    reportedDeviceTimeZone: 'Europe/Kyiv',
    device: { id: 'cce93010-158e-4d65-bdd8-38672203a59b' },
    ...overrides,
  };
  return gameCenterAuthRequestSchema.parse(request);
}

function createVerifier() {
  return new GameCenterProofVerifier(
    authenticationEnvironment,
    { getPublicKey: vi.fn().mockResolvedValue(publicKey) },
    () => now,
  );
}

describe('GameCenterProofVerifier', () => {
  it('constructs the prescribed UTF-8 and big-endian UInt64 byte sequence', () => {
    expect(
      createGameCenterSignedBytes(
        'T',
        'B',
        0x01_02_03_04_05_06_07_08n,
        Buffer.from([0xff]),
      ).toString('hex'),
    ).toBe('54420102030405060708ff');
  });

  it('verifies a fresh proof and returns only digests plus replay metadata', async () => {
    const result = await createVerifier().verify(createRequest());

    expect(result.authenticatedAt).toEqual(new Date(Number(timestamp)));
    expect(result.currentIdentity.digest).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.secondaryMigrationIdentity.digest).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.proofFingerprint).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.proofExpiresAt).toEqual(
      new Date(
        Number(timestamp) + (authenticationEnvironment.gameCenterProofMaxAgeSeconds + 600) * 1_000,
      ),
    );
    expect(JSON.stringify(result)).not.toContain('team-player-1');
  });

  it.each([
    [{ scopedIdsPersistent: false }, 'NONPERSISTENT_ID'],
    [
      {
        proof: {
          ...createRequest().proof,
          bundleId: 'app.someone-else.game',
        },
      },
      'BUNDLE_MISMATCH',
    ],
  ] as const)('rejects invalid identity conditions', async (overrides, expectedCode) => {
    await expect(createVerifier().verify(createRequest(overrides))).rejects.toMatchObject({
      code: expectedCode,
    });
  });

  it('accepts a temporary identifier only when the local allowance is set', async () => {
    // Game Center hands sandbox players temporary scoped identifiers, and every
    // build that is not from TestFlight or the App Store is a sandbox player.
    // The allowance exists so a development build can sign in at all; the
    // environment schema refuses it outside a local deployment.
    const permissive = new GameCenterProofVerifier(
      { ...authenticationEnvironment, allowNonPersistentGameCenterIds: true },
      { getPublicKey: vi.fn().mockResolvedValue(publicKey) },
      () => now,
    );

    const verified = await permissive.verify(createRequest({ scopedIdsPersistent: false }));
    expect(verified.currentIdentity.digest).toMatch(/^[a-f0-9]{64}$/u);

    // Every other check still applies to that same request.
    await expect(
      permissive.verify(
        createRequest({
          scopedIdsPersistent: false,
          proof: { ...createRequest().proof, bundleId: 'app.someone-else.game' },
        }),
      ),
    ).rejects.toMatchObject({ code: 'BUNDLE_MISMATCH' });
  });

  it('rejects stale, future, and cryptographically invalid proofs', async () => {
    const staleTimestamp = BigInt(
      now.getTime() - (authenticationEnvironment.gameCenterProofMaxAgeSeconds + 1) * 1_000,
    );
    const stale = createRequest({
      proof: { ...createRequest().proof, timestamp: staleTimestamp.toString() },
    });
    await expect(createVerifier().verify(stale)).rejects.toMatchObject({ code: 'PROOF_EXPIRED' });

    const futureTimestamp = BigInt(
      now.getTime() + (authenticationEnvironment.gameCenterProofClockSkewSeconds + 1) * 1_000,
    );
    const future = createRequest({
      proof: { ...createRequest().proof, timestamp: futureTimestamp.toString() },
    });
    await expect(createVerifier().verify(future)).rejects.toMatchObject({ code: 'PROOF_EXPIRED' });

    const invalid = createRequest({
      proof: {
        ...createRequest().proof,
        signatureBase64: Buffer.from('invalid').toString('base64'),
      },
    });
    await expect(createVerifier().verify(invalid)).rejects.toMatchObject({ code: 'INVALID_PROOF' });
  });

  it('rejects unapproved key hosts before invoking the provider', async () => {
    const getPublicKey = vi.fn().mockResolvedValue(publicKey);
    const verifier = new GameCenterProofVerifier(
      authenticationEnvironment,
      { getPublicKey },
      () => now,
    );
    const request = createRequest({
      proof: {
        ...createRequest().proof,
        publicKeyUrl: 'https://attacker.example/key.cer',
      },
    });

    await expect(verifier.verify(request)).rejects.toBeInstanceOf(GameCenterVerificationError);
    expect(getPublicKey).not.toHaveBeenCalled();
  });

  it('maps a trusted-key retrieval failure without leaking its cause', async () => {
    const verifier = new GameCenterProofVerifier(
      authenticationEnvironment,
      { getPublicKey: vi.fn().mockRejectedValue(new Error('private network details')) },
      () => now,
    );

    await expect(verifier.verify(createRequest())).rejects.toMatchObject({
      code: 'KEY_UNAVAILABLE',
      message: expect.not.stringContaining('private network'),
    });
  });
});
