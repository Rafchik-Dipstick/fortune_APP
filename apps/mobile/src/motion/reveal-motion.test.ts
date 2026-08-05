import { describe, expect, it } from 'vitest';

import { getRevealMotionProfile } from './reveal-motion';

describe('reveal motion profiles', () => {
  it('keeps the default flip inside the 600–750 ms specification window', () => {
    const profile = getRevealMotionProfile(false);

    expect(profile.cardDurationMs).toBeGreaterThanOrEqual(600);
    expect(profile.cardDurationMs).toBeLessThanOrEqual(750);
    expect(profile.usesPerspective).toBe(true);
  });

  it('uses a 150–250 ms crossfade without perspective for Reduce Motion', () => {
    const profile = getRevealMotionProfile(true);

    expect(profile.cardDurationMs).toBeGreaterThanOrEqual(150);
    expect(profile.cardDurationMs).toBeLessThanOrEqual(250);
    expect(profile.contentDelayMs).toBe(0);
    expect(profile.usesPerspective).toBe(false);
  });
});
