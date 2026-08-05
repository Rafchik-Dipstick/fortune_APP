import { layout, spacing } from './tokens';

export type WindowClass = 'compact' | 'medium' | 'regular';

export function classifyWindow(width: number): WindowClass {
  if (width <= layout.compactMax) {
    return 'compact';
  }

  if (width <= layout.mediumMax) {
    return 'medium';
  }

  return 'regular';
}

export function getHorizontalGutter(width: number): number {
  const windowClass = classifyWindow(width);
  if (windowClass === 'compact') {
    return spacing.md;
  }

  return windowClass === 'medium' ? spacing.lg : spacing.xl;
}

export function getOracleCardWidth(width: number): number {
  const availableWidth = Math.max(width - getHorizontalGutter(width) * 2, 0);
  return Math.min(availableWidth * 0.84, layout.cardMax);
}

export function getArtReviewCardWidths(width: number) {
  const availableWidth = Math.max(width - getHorizontalGutter(width) * 2, 0);
  const compactWidth = Math.min(Math.max((availableWidth - spacing.sm) / 2, 96), 148);

  return {
    compact: compactWidth,
    full: getOracleCardWidth(width),
  } as const;
}
