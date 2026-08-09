import { describe, expect, it } from 'vitest';

import {
  resolveConfiguredBuildProfile,
  resolveBuildProfile,
  resolveBundleIdentifier,
  resolveIosBuildNumber,
  supportedLocalesForProfile,
} from '../../app.config';

describe('mobile build profiles', () => {
  it('keeps the pseudo-locale out of production', () => {
    expect(supportedLocalesForProfile('development')).toEqual(['en', 'en-XA']);
    expect(supportedLocalesForProfile('preview')).toEqual(['en', 'en-XA']);
    expect(supportedLocalesForProfile('production')).toEqual(['en']);
  });

  it('fails closed when production has no confirmed bundle identifier', () => {
    expect(() => resolveBundleIdentifier('production', undefined)).toThrow(
      'APP_BUNDLE_ID is required for production',
    );
  });

  it('uses isolated non-production identifiers by default', () => {
    expect(resolveBundleIdentifier('development', undefined)).toBe('app.fortuneness.dev2');
    expect(resolveBundleIdentifier('preview', undefined)).toBe('app.fortuneness.preview');
  });

  it('defaults unknown local invocations to development', () => {
    expect(resolveBuildProfile(undefined)).toBe('development');
    expect(resolveBuildProfile('unexpected')).toBe('development');
  });

  it('supports a production profile without depending on EAS', () => {
    expect(resolveConfiguredBuildProfile('production', undefined)).toBe('production');
    expect(resolveConfiguredBuildProfile('  production  ', 'development')).toBe('production');
    expect(resolveConfiguredBuildProfile(undefined, 'preview')).toBe('preview');
    expect(resolveConfiguredBuildProfile('', 'production')).toBe('production');
  });

  it('validates build numbers supplied by direct iOS CI', () => {
    expect(resolveIosBuildNumber(undefined)).toBeUndefined();
    expect(resolveIosBuildNumber('')).toBeUndefined();
    expect(resolveIosBuildNumber(' 1013 ')).toBe('1013');
    expect(() => resolveIosBuildNumber('0')).toThrow('positive integer');
    expect(() => resolveIosBuildNumber('1.2')).toThrow('positive integer');
  });
});
