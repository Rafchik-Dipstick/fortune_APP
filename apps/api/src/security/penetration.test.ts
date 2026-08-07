import { SignJWT } from 'jose';
import pino from 'pino';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { apiPaths } from '@fortuneness/api-contracts';

import { createApiApp } from '../app.js';
import { AccessTokenService } from '../auth/access-token.js';
import { CachedGameCenterPublicKeyProvider } from '../auth/game-center-public-key.js';
import { createTestApiEnvironment } from '../config/environment.fixture.js';
import { ApiReadiness } from '../health/readiness.js';
import { decryptBytes, encryptBytes, resolveVersionedKey } from './crypto.js';
import { EgressDeniedError } from './egress.js';

/**
 * Phase 13 penetration retest of the Phase 0 trust and abuse model.
 *
 * These are adversarial tests written from the attacker's side of each trust
 * boundary, kept separate from the unit tests that prove each module's happy
 * path. They cover the boundaries that can be attacked without a database;
 * the quota-race, deletion-race, and ownership cases are attacked in the
 * integration suites owned by Phases 6, 9, and 12, and are listed in
 * `docs/phase13-penetration-retest.md`.
 */

const silentLogger = pino({ enabled: false });
const environment = createTestApiEnvironment({
  corsOrigins: ['https://preview.fortuneness.app'],
  logLevel: 'silent',
});

const createProbeApp = () =>
  createApiApp({
    environment,
    logger: silentLogger,
    readiness: new ApiReadiness(() => Promise.resolve()),
    configureRoutes: (app) => {
      app.post('/v1/probe', (probeRequest, response) => {
        response.status(200).json({ received: probeRequest.body });
      });
    },
  });

describe('AC-01 — Game Center public-key URL is an SSRF input', () => {
  it.each([
    ['the cloud metadata address', 'https://169.254.169.254/latest/meta-data/'],
    ['loopback', 'https://127.0.0.1/public-key.cer'],
    ['a private host', 'https://10.0.0.1/public-key.cer'],
    ['a suffix lookalike', 'https://static.gc.apple.com.attacker.example/key.cer'],
    ['a prefix lookalike', 'https://attacker-static.gc.apple.com/key.cer'],
    ['plaintext transport', 'http://static.gc.apple.com/key.cer'],
    ['an alternate port', 'https://static.gc.apple.com:8443/key.cer'],
    ['embedded credentials', 'https://a:b@static.gc.apple.com/key.cer'],
    ['a file URL', 'file:///etc/passwd'],
    ['a gopher URL', 'gopher://static.gc.apple.com/key.cer'],
  ])('refuses %s without attempting a fetch', async (_description, publicKeyUrl) => {
    const fetchCertificate = vi.fn();
    const provider = new CachedGameCenterPublicKeyProvider(environment.authentication, {
      fetchCertificate,
    });

    await expect(provider.getPublicKey(publicKeyUrl, new Date())).rejects.toBeInstanceOf(
      EgressDeniedError,
    );
    expect(fetchCertificate).not.toHaveBeenCalled();
  });

  it('refuses an allowlisted host that resolves internally, after the URL passes', async () => {
    const fetchCertificate = vi
      .fn()
      .mockRejectedValue(new EgressDeniedError('PRIVATE_ADDRESS', 'resolved to a private address'));
    const provider = new CachedGameCenterPublicKeyProvider(environment.authentication, {
      fetchCertificate,
    });

    await expect(
      provider.getPublicKey('https://static.gc.apple.com/key.cer', new Date()),
    ).rejects.toBeInstanceOf(EgressDeniedError);
    expect(fetchCertificate).toHaveBeenCalledTimes(1);
  });

  it('does not cache a denied URL as a usable key', async () => {
    const fetchCertificate = vi.fn().mockRejectedValue(new Error('unreachable'));
    const provider = new CachedGameCenterPublicKeyProvider(environment.authentication, {
      fetchCertificate,
    });

    await expect(
      provider.getPublicKey('https://static.gc.apple.com/key.cer', new Date()),
    ).rejects.toThrow();
    await expect(
      provider.getPublicKey('https://static.gc.apple.com/key.cer', new Date()),
    ).rejects.toThrow();
    expect(fetchCertificate).toHaveBeenCalledTimes(2);
  });
});

describe('AC-02 and AC-04 — session forgery and replay', () => {
  const accessTokens = new AccessTokenService(environment.authentication);
  const signingKey =
    resolveVersionedKey(environment.authentication.jwtAccessKeys, 'v1') ?? Buffer.alloc(32);
  const claims = {
    auth_time: Math.floor(Date.now() / 1_000),
    sid: '2b3d4f5a-8c6b-4d8e-9f0a-1b2c3d4e5f60',
    sub: '9f1c0a7e-2b3d-4f5a-8c6b-7d8e9f0a1b2c',
    sv: 3,
  };

  const sign = (
    overrides: {
      alg?: string;
      audience?: string;
      expiresIn?: number;
      issuer?: string;
      kid?: string;
    } = {},
  ) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: overrides.alg ?? 'HS256', kid: overrides.kid ?? 'v1', typ: 'JWT' })
      .setSubject(claims.sub)
      .setIssuer(overrides.issuer ?? environment.authentication.jwtIssuer)
      .setAudience(overrides.audience ?? environment.authentication.jwtAudience)
      .setIssuedAt()
      .setExpirationTime(Math.floor(Date.now() / 1_000) + (overrides.expiresIn ?? 900))
      .sign(signingKey);

  it('accepts only a token this service signed', async () => {
    await expect(accessTokens.verify(await sign())).resolves.toMatchObject({ sessionVersion: 3 });
  });

  it('rejects a token whose payload was altered after signing', async () => {
    const [header, payload, signature] = (await sign()).split('.');
    const tampered = Buffer.from(JSON.stringify({ ...claims, sv: 99 }), 'utf8').toString(
      'base64url',
    );

    expect(payload).not.toBe(tampered);
    await expect(
      accessTokens.verify(`${header ?? ''}.${tampered}.${signature ?? ''}`),
    ).rejects.toThrow();
  });

  it('rejects an unsigned "alg: none" token', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', kid: 'v1', typ: 'JWT' })).toString(
      'base64url',
    );
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');

    await expect(accessTokens.verify(`${header}.${payload}.`)).rejects.toThrow();
  });

  it('rejects a token minted for another issuer or audience', async () => {
    await expect(accessTokens.verify(await sign({ issuer: 'attacker' }))).rejects.toThrow();
    await expect(accessTokens.verify(await sign({ audience: 'attacker' }))).rejects.toThrow();
  });

  it('rejects an expired token beyond the clock tolerance', async () => {
    await expect(accessTokens.verify(await sign({ expiresIn: -60 }))).rejects.toThrow();
  });

  it('rejects a key version that is not present in the ring', async () => {
    await expect(accessTokens.verify(await sign({ kid: 'v9' }))).rejects.toThrow();
  });

  it('refuses a prototype-inherited key version instead of resolving Object.prototype', async () => {
    for (const kid of ['constructor', 'toString', 'valueOf', '__proto__', 'hasOwnProperty']) {
      await expect(accessTokens.verify(await sign({ kid }))).rejects.toThrow();
    }
  });

  it('refuses a prototype-inherited ciphertext key version', () => {
    const ciphertext = encryptBytes(
      Buffer.from('secret'),
      environment.authentication.refreshReplayEncryptionKeys,
      'context',
    );

    for (const keyVersion of ['constructor', 'toString', '__proto__']) {
      expect(() =>
        decryptBytes(
          ciphertext.encrypted,
          keyVersion,
          environment.authentication.refreshReplayEncryptionKeys,
          'context',
        ),
      ).toThrow(/key version is unavailable/u);
    }
  });

  it('rejects structurally invalid bearer material outright', async () => {
    for (const token of ['', 'not-a-token', 'a.b', 'a.b.c.d', '.'.repeat(64)]) {
      await expect(accessTokens.verify(token)).rejects.toThrow();
    }
  });
});

describe('AC-10 — App Store webhook spoofing', () => {
  const createWebhookApp = (ingest: {
    ingest: (payload: string) => Promise<{ notificationUuid: string }>;
  }) =>
    createApiApp({
      environment,
      logger: silentLogger,
      readiness: new ApiReadiness(() => Promise.resolve()),
      configureRoutes: (app) => {
        app.post(apiPaths.appStoreWebhook, (webhookRequest, response, next) => {
          void (async () => {
            try {
              const body = webhookRequest.body as { signedPayload?: unknown };
              if (typeof body.signedPayload !== 'string') {
                response.status(400).json({});
                return;
              }
              await ingest.ingest(body.signedPayload);
              response.status(200).json({});
            } catch (error) {
              next(error);
            }
          })();
        });
      },
    });

  it('never passes a malformed envelope to the verifier', async () => {
    const ingest = vi.fn();
    const app = createWebhookApp({ ingest });

    for (const body of [
      {},
      { signedPayload: 42 },
      { signedPayload: null },
      { notification: 'x' },
      [],
    ]) {
      await request(app).post(apiPaths.appStoreWebhook).send(body).expect(400);
    }
    expect(ingest).not.toHaveBeenCalled();
  });

  it('rejects an envelope past the commerce body bound without invoking the verifier', async () => {
    const ingest = vi.fn();
    const response = await request(createWebhookApp({ ingest }))
      .post(apiPaths.appStoreWebhook)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ signedPayload: 'A'.repeat(4 * 1024 * 1024) }));

    expect(response.status).toBe(400);
    expect(ingest).not.toHaveBeenCalled();
  });
});

describe('AC-16 and AC-20 — response and transport leakage', () => {
  it('returns a stable envelope that carries no internal detail', async () => {
    const app = createApiApp({
      environment,
      logger: silentLogger,
      readiness: new ApiReadiness(() => Promise.resolve()),
      configureRoutes: (configuredApp) => {
        configuredApp.get('/v1/explode', () => {
          throw new Error(
            'connect ECONNREFUSED 10.0.0.5:5432 for postgresql://postgres:hunter2@db.internal:5432/fortuneness',
          );
        });
      },
    });

    const response = await request(app).get('/v1/explode').expect(500);
    const serialized = JSON.stringify(response.body);

    expect(response.body.error.code).toBe('INTERNAL_ERROR');
    expect(serialized).not.toContain('hunter2');
    expect(serialized).not.toContain('10.0.0.5');
    expect(serialized).not.toContain('ECONNREFUSED');
    expect(serialized).not.toContain('db.internal');
    expect(Object.keys(response.body.error).sort()).toEqual([
      'code',
      'message',
      'requestId',
      'retryable',
      'sameKeyRetrySafe',
    ]);
  });

  it('does not advertise the server implementation', async () => {
    const response = await request(createProbeApp()).post('/v1/probe').send({}).expect(200);

    expect(response.headers['x-powered-by']).toBeUndefined();
    expect(response.headers['server']).toBeUndefined();
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  it('does not reflect an attacker-chosen request ID that is not a UUID', async () => {
    const response = await request(createProbeApp())
      .post('/v1/probe')
      .set('X-Request-ID', '<script>alert(1)</script>')
      .send({})
      .expect(200);

    expect(response.headers['x-request-id']).not.toContain('<script>');
    expect(response.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
  });

  it('refuses a cross-origin request from an origin that is not configured', async () => {
    const response = await request(createProbeApp())
      .post('/v1/probe')
      .set('Origin', 'https://evil.example')
      .send({})
      .expect(400);

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('does not parse a JSON body smuggled under a non-JSON content type', async () => {
    const response = await request(createProbeApp())
      .post('/v1/probe')
      .set('Content-Type', 'text/plain')
      .send('{"privileged":true}')
      .expect(200);

    expect(response.body.received).not.toMatchObject({ privileged: true });
  });

  it('does not let a JSON body mutate Object.prototype', async () => {
    await request(createProbeApp())
      .post('/v1/probe')
      .send(JSON.parse('{"__proto__":{"polluted":"yes"},"constructor":{"polluted":"yes"}}'))
      .expect(200);

    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });

  it('bounds an ordinary request body well below the commerce bound', async () => {
    await request(createProbeApp())
      .post('/v1/probe')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ value: 'x'.repeat(64 * 1024) }))
      .expect(400);
  });
});
