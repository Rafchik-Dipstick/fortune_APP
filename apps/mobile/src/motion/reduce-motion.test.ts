import { describe, expect, it } from 'vitest';

import { shouldReduceMotion } from './reduce-motion';

describe('motion preference resolution', () => {
  it('always respects the iOS Reduce Motion setting', () => {
    expect(shouldReduceMotion(true, false)).toBe(true);
    expect(shouldReduceMotion(true, true)).toBe(true);
  });

  it('allows the player to reduce more motion without changing iOS settings', () => {
    expect(shouldReduceMotion(false, true)).toBe(true);
    expect(shouldReduceMotion(false, false)).toBe(false);
  });
});
