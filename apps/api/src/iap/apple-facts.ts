/**
 * Deterministic ordering for verified Apple facts:
 * (sourceTime, authorityRank, eventPrecedence, sourceId). Newer source time
 * wins; at equal time authoritative reconciliation (rank 1) outranks a
 * notification (rank 0), a corrective event outranks the event it corrects,
 * and the stable source ID breaks any remaining tie.
 */
export interface AppleFactOrder {
  authorityRank: 0 | 1;
  eventPrecedence: number;
  sourceAt: Date;
  sourceId: string;
}

export function compareAppleFactOrder(
  candidate: AppleFactOrder,
  applied: AppleFactOrder,
): number {
  const timeDelta = candidate.sourceAt.getTime() - applied.sourceAt.getTime();
  if (timeDelta !== 0) {
    return timeDelta;
  }
  const authorityDelta = candidate.authorityRank - applied.authorityRank;
  if (authorityDelta !== 0) {
    return authorityDelta;
  }
  const precedenceDelta = candidate.eventPrecedence - applied.eventPrecedence;
  if (precedenceDelta !== 0) {
    return precedenceDelta;
  }
  return candidate.sourceId.localeCompare(applied.sourceId, 'en');
}
