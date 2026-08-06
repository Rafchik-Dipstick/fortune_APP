import { describe, expect, it } from 'vitest';

import {
  countActiveFilters,
  defaultArchiveFilterSelection,
  toReadingFilters,
} from './archive-filters';

const now = new Date('2026-08-06T10:00:00.000Z');

describe('archive filters', () => {
  it('maps the default selection to an unfiltered query', () => {
    expect(toReadingFilters(defaultArchiveFilterSelection, now)).toEqual({});
    expect(countActiveFilters(defaultArchiveFilterSelection)).toBe(0);
  });

  it('maps selected facets and date presets to reading filters', () => {
    const filters = toReadingFilters(
      { arcana: 'MINOR', datePreset: '7d', intention: 'LOVE', suit: 'CUPS' },
      now,
    );
    expect(filters).toEqual({
      arcana: 'MINOR',
      intention: 'LOVE',
      issuedFrom: '2026-07-30T00:00:00.000Z',
      suit: 'CUPS',
    });
    expect(
      countActiveFilters({ arcana: 'MINOR', datePreset: '7d', intention: 'LOVE', suit: 'CUPS' }),
    ).toBe(4);
  });

  it('keeps issuedFrom stable across the same UTC day so the query key does not churn', () => {
    const morning = toReadingFilters({ datePreset: '30d' }, new Date('2026-08-06T00:00:00.001Z'));
    const evening = toReadingFilters({ datePreset: '30d' }, new Date('2026-08-06T23:59:59.999Z'));

    expect(morning.issuedFrom).toBe('2026-07-07T00:00:00.000Z');
    expect(evening).toEqual(morning);
  });
});
