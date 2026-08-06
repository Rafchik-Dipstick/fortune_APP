import { describe, expect, it } from 'vitest';

import { getCollectionGridLayout } from './collection-layout';

describe('getCollectionGridLayout', () => {
  it('keeps at least two readable columns at the narrowest supported width', () => {
    const grid = getCollectionGridLayout(320, 16);
    expect(grid.columns).toBe(2);
    expect(grid.cellWidth).toBeGreaterThanOrEqual(104);
  });

  it('adds columns from available width rather than device names', () => {
    const compact = getCollectionGridLayout(375, 16);
    const medium = getCollectionGridLayout(744, 24);
    const regular = getCollectionGridLayout(1024, 32);
    expect(compact.columns).toBeLessThan(medium.columns);
    expect(medium.columns).toBeLessThanOrEqual(regular.columns);
    for (const grid of [compact, medium, regular]) {
      expect(grid.cellWidth).toBeGreaterThanOrEqual(104);
      expect(grid.cellWidth).toBeLessThanOrEqual(180);
      expect(grid.cellWidth * grid.columns + grid.gap * (grid.columns - 1)).toBeLessThanOrEqual(
        Math.min(1024, 1100),
      );
    }
  });

  it('caps content width on very wide windows', () => {
    const wide = getCollectionGridLayout(1600, 32);
    const capped = getCollectionGridLayout(1100 + 64, 32);
    expect(wide.columns).toBe(capped.columns);
    expect(wide.cellWidth).toBeLessThanOrEqual(180);
  });
});
