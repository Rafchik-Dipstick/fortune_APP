import { randomInt } from 'node:crypto';

import { type FortuneIntention, type FortuneOrientation } from '@fortuneness/api-contracts';

export interface FortuneContentCandidate {
  cardKey: string;
  intention: FortuneIntention;
  orientation: FortuneOrientation;
  templateId: string;
}

export interface FortuneRandomSource {
  index(exclusiveMaximum: number): number;
  unit(): number;
}

export interface FortuneSelectionInput<TCandidate extends FortuneContentCandidate> {
  candidates: readonly TCandidate[];
  intention: FortuneIntention;
  recentCardKeys: ReadonlySet<string>;
  recentTemplateIds: ReadonlySet<string>;
  totalDeckCards: number;
  unlockedCardKeys: ReadonlySet<string>;
}

export interface FortuneSelection<TCandidate extends FortuneContentCandidate> {
  candidate: TCandidate;
  orientation: FortuneOrientation;
}

export class FortuneContentUnavailableError extends Error {
  constructor() {
    super('No active fortune content exists for the selected orientation and intention.');
    this.name = 'FortuneContentUnavailableError';
  }
}

export class CryptographicFortuneRandomSource implements FortuneRandomSource {
  index(exclusiveMaximum: number): number {
    if (!Number.isSafeInteger(exclusiveMaximum) || exclusiveMaximum < 1) {
      throw new RangeError('The random index maximum must be a positive safe integer.');
    }
    return randomInt(exclusiveMaximum);
  }

  unit(): number {
    return randomInt(1_000_000_000) / 1_000_000_000;
  }
}

function chooseOne<T>(values: readonly T[], random: FortuneRandomSource): T {
  const selected = values[random.index(values.length)];
  if (selected === undefined) {
    throw new RangeError('The random source returned an out-of-range index.');
  }
  return selected;
}

function groupByCard<TCandidate extends FortuneContentCandidate>(
  candidates: readonly TCandidate[],
): Map<string, TCandidate[]> {
  const grouped = new Map<string, TCandidate[]>();
  for (const candidate of candidates) {
    const variants = grouped.get(candidate.cardKey);
    if (variants === undefined) {
      grouped.set(candidate.cardKey, [candidate]);
    } else {
      variants.push(candidate);
    }
  }
  return grouped;
}

export function selectFortuneContent<TCandidate extends FortuneContentCandidate>(
  input: FortuneSelectionInput<TCandidate>,
  random: FortuneRandomSource,
): FortuneSelection<TCandidate> {
  if (!Number.isInteger(input.totalDeckCards) || input.totalDeckCards < 1) {
    throw new RangeError('The total deck card count must be a positive integer.');
  }
  const orientation: FortuneOrientation = random.unit() < 0.7 ? 'UPRIGHT' : 'REVERSED';
  const base = input.candidates.filter(
    (candidate) => candidate.intention === input.intention && candidate.orientation === orientation,
  );
  if (base.length === 0) {
    throw new FortuneContentUnavailableError();
  }

  const withoutEitherRecentDimension = base.filter(
    (candidate) =>
      !input.recentTemplateIds.has(candidate.templateId) &&
      !input.recentCardKeys.has(candidate.cardKey),
  );
  const withTemplateExclusionRelaxed = base.filter(
    (candidate) => !input.recentCardKeys.has(candidate.cardKey),
  );
  const eligible =
    withoutEitherRecentDimension.length > 0
      ? withoutEitherRecentDimension
      : withTemplateExclusionRelaxed.length > 0
        ? withTemplateExclusionRelaxed
        : base;
  const byCard = groupByCard(eligible);
  const unseenCardKeys: string[] = [];
  const seenCardKeys: string[] = [];
  for (const cardKey of byCard.keys()) {
    (input.unlockedCardKeys.has(cardKey) ? seenCardKeys : unseenCardKeys).push(cardKey);
  }

  let cardPool: readonly string[];
  if (
    unseenCardKeys.length > 0 &&
    seenCardKeys.length > 0 &&
    input.unlockedCardKeys.size < input.totalDeckCards
  ) {
    cardPool = random.unit() < 0.65 ? unseenCardKeys : seenCardKeys;
  } else {
    cardPool = unseenCardKeys.length > 0 ? unseenCardKeys : seenCardKeys;
  }
  const cardKey = chooseOne(cardPool, random);
  const variants = byCard.get(cardKey);
  if (variants === undefined) {
    throw new RangeError('The selected card group has no content variants.');
  }
  return { orientation, candidate: chooseOne(variants, random) };
}
