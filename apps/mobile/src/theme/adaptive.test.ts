import { describe, expect, it } from 'vitest';

import { classifyWindow, getHorizontalGutter, getOracleCardWidth } from './adaptive-layout';

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
});
