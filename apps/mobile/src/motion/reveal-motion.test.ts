import { describe, expect, it } from 'vitest';

import { getRevealMotionProfile } from './reveal-motion';

describe('reveal motion profiles', () => {
  it('keeps the default flip inside the 600–750 ms specification window', () => {
    const profile = getRevealMotionProfile(false);

    expect(profile.cardDurationMs).toBeGreaterThanOrEqual(600);
    expect(profile.cardDurationMs).toBeLessThanOrEqual(750);
    expect(profile.usesPerspective).toBe(true);
  });

  it('enables the sheen, burst, and content drift flourishes by default', () => {
    const profile = getRevealMotionProfile(false);

    expect(profile.flourishes).toBe(true);
    expect(profile.sheenDurationMs).toBeGreaterThan(0);
    expect(profile.burstDurationMs).toBeGreaterThan(0);
    expect(profile.contentTravel).toBeGreaterThan(0);
  });

  it('uses a 150–250 ms crossfade without perspective for Reduce Motion', () => {
    const profile = getRevealMotionProfile(true);

    expect(profile.cardDurationMs).toBeGreaterThanOrEqual(150);
    expect(profile.cardDurationMs).toBeLessThanOrEqual(250);
    expect(profile.contentDelayMs).toBe(0);
    expect(profile.usesPerspective).toBe(false);
  });

  it('disables every flourish and content drift for Reduce Motion', () => {
    const profile = getRevealMotionProfile(true);

    expect(profile.flourishes).toBe(false);
    expect(profile.sheenDurationMs).toBe(0);
    expect(profile.burstDurationMs).toBe(0);
    expect(profile.contentTravel).toBe(0);
  });
});
