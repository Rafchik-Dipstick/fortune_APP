import type {
  FortuneIntention,
  FortuneOrientation,
  TarotArcana,
  TarotSuit,
} from '@fortuneness/api-contracts';

import { type ArchiveReadingFilters } from '../local-data/archive-store';

export type ArchiveDatePreset = '7d' | '30d' | '90d' | 'all';

export interface ArchiveFilterSelection {
  arcana?: TarotArcana;
  datePreset: ArchiveDatePreset;
  intention?: FortuneIntention;
  orientation?: FortuneOrientation;
  suit?: TarotSuit;
}

export const defaultArchiveFilterSelection: ArchiveFilterSelection = { datePreset: 'all' };

export const intentionLabels: Record<FortuneIntention, string> = {
  GENERAL: 'General',
  LOVE: 'Love',
  WORK: 'Work',
  GROWTH: 'Growth',
};

export const orientationLabels: Record<FortuneOrientation, string> = {
  UPRIGHT: 'Upright',
  REVERSED: 'Reversed',
};

export const arcanaLabels: Record<TarotArcana, string> = {
  MAJOR: 'Major Arcana',
  MINOR: 'Minor Arcana',
};

export const suitLabels: Record<TarotSuit, string> = {
  WANDS: 'Wands',
  CUPS: 'Cups',
  SWORDS: 'Swords',
  PENTACLES: 'Pentacles',
};

export const datePresetLabels: Record<ArchiveDatePreset, string> = {
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  all: 'All time',
};

const presetDays: Record<Exclude<ArchiveDatePreset, 'all'>, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

export function toReadingFilters(
  selection: ArchiveFilterSelection,
  now: Date,
): ArchiveReadingFilters {
  const filters: ArchiveReadingFilters = {
    ...(selection.arcana === undefined ? {} : { arcana: selection.arcana }),
    ...(selection.intention === undefined ? {} : { intention: selection.intention }),
    ...(selection.orientation === undefined ? {} : { orientation: selection.orientation }),
    ...(selection.suit === undefined ? {} : { suit: selection.suit }),
  };
  if (selection.datePreset !== 'all') {
    const days = presetDays[selection.datePreset];
    // Floor to the UTC day so the value — and the query key derived from it —
    // stays stable across re-renders and facet toggles within the same day.
    const dayMs = 86_400_000;
    const startOfToday = Math.floor(now.getTime() / dayMs) * dayMs;
    filters.issuedFrom = new Date(startOfToday - days * dayMs).toISOString();
  }
  return filters;
}

export function countActiveFilters(selection: ArchiveFilterSelection): number {
  return [
    selection.arcana,
    selection.intention,
    selection.orientation,
    selection.suit,
    selection.datePreset === 'all' ? undefined : selection.datePreset,
  ].filter((value) => value !== undefined).length;
}
