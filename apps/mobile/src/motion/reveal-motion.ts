export interface RevealMotionProfile {
  cardDurationMs: number;
  contentDelayMs: number;
  contentDurationMs: number;
  usesPerspective: boolean;
}

export function getRevealMotionProfile(reduceMotion: boolean): RevealMotionProfile {
  if (reduceMotion) {
    return {
      cardDurationMs: 200,
      contentDelayMs: 0,
      contentDurationMs: 150,
      usesPerspective: false,
    };
  }

  return {
    cardDurationMs: 675,
    contentDelayMs: 100,
    contentDurationMs: 300,
    usesPerspective: true,
  };
}
