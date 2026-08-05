import { describe, expect, it } from 'vitest';

import {
  classifyWindow,
  getArtReviewCardWidths,
  getHorizontalGutter,
  getOracleCardWidth,
} from './adaptive-layout';

describe('adaptive layout rules', () => {
  it('uses the specification breakpoints', () => {
    expect(classifyWindow(320)).toBe('compact');
    expect(classifyWindow(599)).toBe('compact');
    expect(classifyWindow(600)).toBe('medium');
    expect(classifyWindow(899)).toBe('medium');
    expect(classifyWindow(900)).toBe('regular');
  });

  it('keeps the Oracle card within available compact width and its 340 point cap', () => {
    expect(getOracleCardWidth(320)).toBeLessThanOrEqual(288);
    expect(getOracleCardWidth(1024)).toBe(340);
  });

  it('increases gutters with the available window class', () => {
    expect(getHorizontalGutter(320)).toBeLessThan(getHorizontalGutter(700));
    expect(getHorizontalGutter(700)).toBeLessThan(getHorizontalGutter(1024));
  });

  it('keeps two compact art-review cards inside a 320 point viewport', () => {
    const viewport = 320;
    const availableWidth = viewport - getHorizontalGutter(viewport) * 2;
    const widths = getArtReviewCardWidths(viewport);

    expect(widths.compact * 2 + 12).toBeLessThanOrEqual(availableWidth);
    expect(widths.full).toBeLessThanOrEqual(availableWidth);
  });

  it('caps regular art-review cards at their intended sizes', () => {
    expect(getArtReviewCardWidths(1024)).toEqual({ compact: 148, full: 340 });
  });
});
