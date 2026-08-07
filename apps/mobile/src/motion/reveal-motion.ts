export interface RevealMotionProfile {
  burstDurationMs: number;
  cardDurationMs: number;
  contentDelayMs: number;
  contentDurationMs: number;
  contentTravel: number;
  flourishes: boolean;
  sheenDelayMs: number;
  sheenDurationMs: number;
  usesPerspective: boolean;
}

export function getRevealMotionProfile(reduceMotion: boolean): RevealMotionProfile {
  if (reduceMotion) {
    return {
      burstDurationMs: 0,
      cardDurationMs: 200,
      contentDelayMs: 0,
      contentDurationMs: 150,
      contentTravel: 0,
      flourishes: false,
      sheenDelayMs: 0,
      sheenDurationMs: 0,
      usesPerspective: false,
    };
  }

  return {
    burstDurationMs: 950,
    cardDurationMs: 675,
    contentDelayMs: 200,
    contentDurationMs: 420,
    contentTravel: 18,
    flourishes: true,
    sheenDelayMs: 140,
    sheenDurationMs: 680,
    usesPerspective: true,
  };
}
