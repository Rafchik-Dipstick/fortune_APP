import pino from 'pino';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApiApp } from '../app.js';
import { createTestApiEnvironment } from '../config/environment.fixture.js';
import { ApiReadiness } from '../health/readiness.js';

const legalPaths = ['/privacy', '/terms', '/support'] as const;

const createTestApp = (supportEmail?: string) =>
  createApiApp({
    environment: createTestApiEnvironment({
      logLevel: 'silent',
      ...(supportEmail === undefined ? {} : { supportEmail }),
    }),
    logger: pino({ enabled: false }),
    readiness: new ApiReadiness(async () => Promise.resolve()),
  });

describe('legal routes', () => {
  it.each(legalPaths)('serves %s as an HTML document without authentication', async (path) => {
    const response = await request(createTestApp()).get(path);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/text\/html/u);
    expect(response.text).toContain('<!doctype html>');
    expect(response.text).toContain('Fortuneness');
  });

  it.each(legalPaths)('forbids scripts and framing on %s', async (path) => {
    const response = await request(createTestApp()).get(path);

    // The pages take no input and run no code; a policy that allowed either
    // would be a standing invitation on the only unauthenticated HTML surface.
    expect(response.headers['content-security-policy']).toContain("default-src 'none'");
    expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(response.text).not.toContain('<script');
  });

  it('prints the configured support address rather than a baked-in constant', async () => {
    const response = await request(createTestApp('help@example.com')).get('/support');

    expect(response.text).toContain('help@example.com');
  });

  it('states the entertainment-only position the App Store expects', async () => {
    const response = await request(createTestApp()).get('/terms');

    expect(response.text).toMatch(/entertainment/iu);
  });

  it('declares no tracking, matching the App Privacy worksheet', async () => {
    const response = await request(createTestApp()).get('/privacy');

    expect(response.text).toMatch(/does not track you/iu);
    expect(response.text).toMatch(/IDFA/u);
  });
});
