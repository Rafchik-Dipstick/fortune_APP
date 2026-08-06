import { describe, expect, it } from 'vitest';

import {
  FortuneContentUnavailableError,
  selectFortuneContent,
  type FortuneContentCandidate,
  type FortuneRandomSource,
} from './selection.js';

class SequenceRandom implements FortuneRandomSource {
  private indexCursor = 0;
  private unitCursor = 0;

  constructor(
    private readonly units: readonly number[],
    private readonly indexes: readonly number[] = [0],
  ) {}

  index(exclusiveMaximum: number): number {
    const value = this.indexes[this.indexCursor % this.indexes.length] ?? 0;
    this.indexCursor += 1;
    return value % exclusiveMaximum;
  }

  unit(): number {
    const value = this.units[this.unitCursor % this.units.length] ?? 0;
    this.unitCursor += 1;
    return value;
  }
}

class DeterministicUniformRandom implements FortuneRandomSource {
  private state = 0x12345678;

  private next(): number {
    this.state = (1_664_525 * this.state + 1_013_904_223) >>> 0;
    return this.state / 0x1_0000_0000;
  }

  index(exclusiveMaximum: number): number {
    return Math.floor(this.next() * exclusiveMaximum);
  }

  unit(): number {
    return this.next();
  }
}

function candidate(
  cardKey: string,
  orientation: 'REVERSED' | 'UPRIGHT',
  variant = 1,
): FortuneContentCandidate {
  return {
    cardKey,
    intention: 'GENERAL',
    orientation,
    templateId: `${cardKey}-${orientation}-${String(variant)}`,
  };
}

describe('fortune content selection', () => {
  it('selects orientation before content and never rerolls a missing orientation', () => {
    expect(() =>
      selectFortuneContent(
        {
          candidates: [candidate('only-upright', 'UPRIGHT')],
          intention: 'GENERAL',
          recentCardKeys: new Set(),
          recentTemplateIds: new Set(),
          totalDeckCards: 78,
          unlockedCardKeys: new Set(),
        },
        new SequenceRandom([0.9]),
      ),
    ).toThrow(FortuneContentUnavailableError);
  });

  it('relaxes recent templates before recent cards', () => {
    const recentCard = candidate('recent-card', 'UPRIGHT');
    const recentTemplate = candidate('other-card', 'UPRIGHT');
    const selection = selectFortuneContent(
      {
        candidates: [recentCard, recentTemplate],
        intention: 'GENERAL',
        recentCardKeys: new Set([recentCard.cardKey]),
        recentTemplateIds: new Set([recentTemplate.templateId]),
        totalDeckCards: 78,
        unlockedCardKeys: new Set(),
      },
      new SequenceRandom([0.1]),
    );

    expect(selection.candidate).toBe(recentTemplate);
  });

  it('keeps orientation and unseen-group frequencies within two points over 100,000 draws', () => {
    const random = new DeterministicUniformRandom();
    const candidates = [
      candidate('upright-unseen', 'UPRIGHT'),
      candidate('upright-seen', 'UPRIGHT'),
      candidate('reversed-unseen', 'REVERSED'),
      candidate('reversed-seen', 'REVERSED'),
    ];
    const unlockedCardKeys = new Set(['upright-seen', 'reversed-seen']);
    let upright = 0;
    let unseen = 0;
    for (let iteration = 0; iteration < 100_000; iteration += 1) {
      const selection = selectFortuneContent(
        {
          candidates,
          intention: 'GENERAL',
          recentCardKeys: new Set(),
          recentTemplateIds: new Set(),
          totalDeckCards: 78,
          unlockedCardKeys,
        },
        random,
      );
      if (selection.orientation === 'UPRIGHT') {
        upright += 1;
      }
      if (!unlockedCardKeys.has(selection.candidate.cardKey)) {
        unseen += 1;
      }
    }

    expect(upright / 100_000).toBeGreaterThanOrEqual(0.68);
    expect(upright / 100_000).toBeLessThanOrEqual(0.72);
    expect(unseen / 100_000).toBeGreaterThanOrEqual(0.63);
    expect(unseen / 100_000).toBeLessThanOrEqual(0.67);
  });

  it('can reach every card and every eligible template variant', () => {
    const candidates = [
      candidate('card-a', 'UPRIGHT', 1),
      candidate('card-a', 'UPRIGHT', 2),
      candidate('card-b', 'UPRIGHT', 1),
      candidate('card-b', 'UPRIGHT', 2),
    ];
    const reached = new Set<string>();
    for (const cardIndex of [0, 1]) {
      for (const templateIndex of [0, 1]) {
        const selected = selectFortuneContent(
          {
            candidates,
            intention: 'GENERAL',
            recentCardKeys: new Set(),
            recentTemplateIds: new Set(),
            totalDeckCards: 78,
            unlockedCardKeys: new Set(),
          },
          new SequenceRandom([0.1], [cardIndex, templateIndex]),
        );
        reached.add(selected.candidate.templateId);
      }
    }

    expect(reached).toEqual(new Set(candidates.map(({ templateId }) => templateId)));
  });
});
