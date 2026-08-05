export const maximumCelestialParticles = 12;

export interface CelestialParticle {
  leftPercent: number;
  opacity: number;
  size: number;
  topPercent: number;
}

export const celestialParticles = [
  { leftPercent: 7, opacity: 0.48, size: 2, topPercent: 9 },
  { leftPercent: 22, opacity: 0.32, size: 3, topPercent: 21 },
  { leftPercent: 43, opacity: 0.52, size: 2, topPercent: 7 },
  { leftPercent: 71, opacity: 0.38, size: 2, topPercent: 17 },
  { leftPercent: 91, opacity: 0.56, size: 3, topPercent: 5 },
  { leftPercent: 13, opacity: 0.36, size: 2, topPercent: 44 },
  { leftPercent: 86, opacity: 0.4, size: 2, topPercent: 39 },
  { leftPercent: 34, opacity: 0.44, size: 2, topPercent: 61 },
  { leftPercent: 62, opacity: 0.3, size: 3, topPercent: 53 },
  { leftPercent: 95, opacity: 0.5, size: 2, topPercent: 68 },
  { leftPercent: 18, opacity: 0.46, size: 3, topPercent: 83 },
  { leftPercent: 77, opacity: 0.34, size: 2, topPercent: 91 },
] as const satisfies readonly CelestialParticle[];

export interface CelestialMotionProfile {
  animated: boolean;
  durationMs: number;
  maximumOpacity: number;
  minimumOpacity: number;
  travelPoints: number;
}

export function getCelestialMotionProfile(reduceMotion: boolean): CelestialMotionProfile {
  if (reduceMotion) {
    return {
      animated: false,
      durationMs: 0,
      maximumOpacity: 0.58,
      minimumOpacity: 0.58,
      travelPoints: 0,
    };
  }

  return {
    animated: true,
    durationMs: 12_000,
    maximumOpacity: 0.72,
    minimumOpacity: 0.52,
    travelPoints: 3,
  };
}
