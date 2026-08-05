import { describe, expect, it } from 'vitest';

import { isPseudoLocaleAvailable, pseudoLocalize, resolveInitialQaLocale } from './pseudo';

describe('Phase 2 pseudo-locale', () => {
  it('is available only for an explicit enabled build profile', () => {
    expect(isPseudoLocaleAvailable('true')).toBe(true);
    expect(isPseudoLocaleAvailable('false')).toBe(false);
    expect(isPseudoLocaleAvailable(undefined)).toBe(false);
  });

  it('honors an en-XA initial override only when the build profile enables it', () => {
    expect(resolveInitialQaLocale('true', 'en-XA')).toBe('en-XA');
    expect(resolveInitialQaLocale('true', 'EN-xa')).toBe('en-XA');
    expect(resolveInitialQaLocale('false', 'en-XA')).toBe('en');
    expect(resolveInitialQaLocale('true', 'en')).toBe('en');
  });

  it('leaves English unchanged when pseudo-localization is off', () => {
    expect(pseudoLocalize('Daily ritual')).toBe('Daily ritual');
  });

  it('wraps and expands copy when pseudo-localization is on', () => {
    const source = 'Daily ritual';
    const result = pseudoLocalize(source, true);

    expect(result.startsWith('⟦')).toBe(true);
    expect(result.endsWith('⟧')).toBe(true);
    expect(result.length).toBeGreaterThan(source.length);
    expect(result).toContain('áá');
  });
});
