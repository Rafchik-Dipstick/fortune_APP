import { describe, expect, it } from 'vitest';

import { getRevealRecoveryBoundary } from './reveal-recovery';

describe('reveal recovery boundaries', () => {
  it('replays the reveal only from the issued boundary', () => {
    expect(getRevealRecoveryBoundary('ISSUED')).toEqual({
      animateCard: true,
      animateContent: true,
      cardAccessible: false,
      contentAccessible: false,
    });
  });

  it('does not hide an already revealed card after termination', () => {
    expect(getRevealRecoveryBoundary('CARD_REVEALED')).toEqual({
      animateCard: false,
      animateContent: true,
      cardAccessible: true,
      contentAccessible: false,
    });
  });

  it('restores fully reachable content without replay before acknowledgement retry', () => {
    expect(getRevealRecoveryBoundary('CONTENT_REACHABLE')).toEqual({
      animateCard: false,
      animateContent: false,
      cardAccessible: true,
      contentAccessible: true,
    });
  });
});
