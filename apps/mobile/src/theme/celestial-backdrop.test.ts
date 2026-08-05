import { describe, expect, it } from 'vitest';

import {
  celestialParticles,
  getCelestialMotionProfile,
  maximumCelestialParticles,
} from './celestial-backdrop';

describe('celestial backdrop', () => {
  it('keeps the deterministic particle field within its performance cap', () => {
    expect(celestialParticles).toHaveLength(maximumCelestialParticles);
    expect(celestialParticles.length).toBeLessThanOrEqual(maximumCelestialParticles);
  });

  it('keeps every particle inside the page with restrained visibility', () => {
    for (const particle of celestialParticles) {
      expect(particle.leftPercent).toBeGreaterThanOrEqual(0);
      expect(particle.leftPercent).toBeLessThanOrEqual(100);
      expect(particle.topPercent).toBeGreaterThanOrEqual(0);
      expect(particle.topPercent).toBeLessThanOrEqual(100);
      expect(particle.size).toBeGreaterThanOrEqual(2);
      expect(particle.size).toBeLessThanOrEqual(3);
      expect(particle.opacity).toBeGreaterThan(0);
      expect(particle.opacity).toBeLessThanOrEqual(0.6);
    }
  });

  it('removes travel and repetition when Reduce Motion is active', () => {
    expect(getCelestialMotionProfile(true)).toEqual({
      animated: false,
      durationMs: 0,
      maximumOpacity: 0.58,
      minimumOpacity: 0.58,
      travelPoints: 0,
    });
    expect(getCelestialMotionProfile(false).durationMs).toBeGreaterThanOrEqual(10_000);
  });
});
