import type { PendingRevealStep } from '../local-data/reading-store';

export interface RevealRecoveryBoundary {
  animateCard: boolean;
  animateContent: boolean;
  cardAccessible: boolean;
  contentAccessible: boolean;
}

export function getRevealRecoveryBoundary(step: PendingRevealStep): RevealRecoveryBoundary {
  switch (step) {
    case 'ISSUED':
      return {
        animateCard: true,
        animateContent: true,
        cardAccessible: false,
        contentAccessible: false,
      };
    case 'CARD_REVEALED':
      return {
        animateCard: false,
        animateContent: true,
        cardAccessible: true,
        contentAccessible: false,
      };
    case 'CONTENT_REACHABLE':
      return {
        animateCard: false,
        animateContent: false,
        cardAccessible: true,
        contentAccessible: true,
      };
  }
}
