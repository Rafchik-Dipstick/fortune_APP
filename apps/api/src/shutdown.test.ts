import { once } from 'node:events';

import express from 'express';
import pino from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { ApiReadiness } from './health/readiness.js';
import { createGracefulShutdown } from './shutdown.js';

describe('createGracefulShutdown', () => {
  it('drains once, closes dependencies, and marks readiness unavailable', async () => {
    const server = express().listen(0, '127.0.0.1');
    await once(server, 'listening');

    const readiness = new ApiReadiness(vi.fn().mockResolvedValue(undefined));
    const closeDependencies = vi.fn().mockResolvedValue(undefined);
    const shutdown = createGracefulShutdown({
      closeDependencies,
      logger: pino({ enabled: false }),
      readiness,
      server,
      timeoutMs: 1_000,
    });

    const firstShutdown = shutdown('test');
    const secondShutdown = shutdown('ignored duplicate');

    expect(secondShutdown).toBe(firstShutdown);
    await firstShutdown;
    expect(closeDependencies).toHaveBeenCalledOnce();
    await expect(readiness.inspect()).resolves.toEqual({
      checks: { database: 'not_ready', process: 'not_ready' },
      status: 'not_ready',
    });
  });
});
