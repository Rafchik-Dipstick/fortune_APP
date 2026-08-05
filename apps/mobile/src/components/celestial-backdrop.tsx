import { useEffect, useState } from 'react';
import { AccessibilityInfo, AppState, StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { useMotionPreference } from '@/motion/motion-preference';
import { shouldReduceMotion } from '@/motion/reduce-motion';
import { celestialParticles, getCelestialMotionProfile } from '@/theme/celestial-backdrop';
import { colors, radii } from '@/theme/tokens';

export function CelestialBackdrop() {
  const systemReduceMotion = useReducedMotion();
  const { reduceMoreMotion } = useMotionPreference();
  const reduceMotion = shouldReduceMotion(systemReduceMotion, reduceMoreMotion);
  const [reduceTransparency, setReduceTransparency] = useState(false);
  const progress = useSharedValue(0);
  const motionProfile = getCelestialMotionProfile(reduceMotion);
  const { animated, durationMs, maximumOpacity, minimumOpacity, travelPoints } = motionProfile;
  const shouldAnimate = animated && !reduceTransparency;

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceTransparencyEnabled()
      .then((enabled) => {
        if (mounted) {
          setReduceTransparency(enabled);
        }
      })
      .catch(() => undefined);

    const subscription = AccessibilityInfo.addEventListener(
      'reduceTransparencyChanged',
      setReduceTransparency,
    );

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    const startAnimation = () => {
      if (!shouldAnimate) {
        progress.value = 0.5;
        return;
      }

      progress.value = withRepeat(
        withTiming(1, {
          duration: durationMs,
          easing: Easing.inOut(Easing.sin),
        }),
        -1,
        true,
      );
    };

    if (AppState.currentState === 'active') {
      startAnimation();
    }

    const subscription = AppState.addEventListener('change', (nextState) => {
      cancelAnimation(progress);
      if (nextState === 'active') {
        startAnimation();
      }
    });

    return () => {
      subscription.remove();
      cancelAnimation(progress);
    };
  }, [durationMs, progress, shouldAnimate]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 1], [minimumOpacity, maximumOpacity]),
    transform: [
      {
        translateY: interpolate(progress.value, [0, 1], [-travelPoints, travelPoints]),
      },
    ],
  }));

  if (reduceTransparency) {
    return null;
  }

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, styles.field, animatedStyle]}
    >
      <View style={[styles.mist, styles.mistTop]} />
      <View style={[styles.mist, styles.mistBottom]} />
      {celestialParticles.map((particle) => (
        <View
          key={`${String(particle.leftPercent)}-${String(particle.topPercent)}`}
          style={[
            styles.particle,
            {
              height: particle.size,
              left: toPercentage(particle.leftPercent),
              opacity: particle.opacity,
              top: toPercentage(particle.topPercent),
              width: particle.size,
            },
          ]}
        />
      ))}
      <View style={[styles.orbit, styles.orbitTop]} />
      <View style={[styles.orbit, styles.orbitBottom]} />
    </Animated.View>
  );
}

function toPercentage(value: number): `${number}%` {
  return `${String(value)}%` as `${number}%`;
}

const styles = StyleSheet.create({
  field: {
    overflow: 'hidden',
  },
  mist: {
    position: 'absolute',
    width: 260,
    height: 260,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(49, 95, 99, 0.12)',
  },
  mistTop: {
    top: -128,
    right: -86,
  },
  mistBottom: {
    bottom: -156,
    left: -104,
    backgroundColor: 'rgba(117, 96, 155, 0.1)',
  },
  particle: {
    position: 'absolute',
    borderRadius: radii.pill,
    backgroundColor: colors.gold,
  },
  orbit: {
    position: 'absolute',
    width: 180,
    height: 90,
    borderColor: 'rgba(212, 175, 103, 0.1)',
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth,
    transform: [{ rotate: '-24deg' }],
  },
  orbitTop: {
    top: '24%',
    left: -72,
  },
  orbitBottom: {
    right: -68,
    bottom: '19%',
    transform: [{ rotate: '31deg' }],
  },
});
