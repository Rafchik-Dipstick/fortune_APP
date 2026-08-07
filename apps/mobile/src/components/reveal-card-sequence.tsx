import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { useMotionPreference } from '@/motion/motion-preference';
import { shouldReduceMotion } from '@/motion/reduce-motion';
import { getRevealMotionProfile } from '@/motion/reveal-motion';
import { getRevealRecoveryBoundary } from '@/motion/reveal-recovery';
import type { PendingRevealStep } from '@/local-data/reading-store';
import { useExperienceFeedback } from '@/feedback/experience-feedback';
import { colors, radii, spacing } from '@/theme/tokens';

import { AppText } from './app-text';
import { TarotCard, type FaceUpCardProps } from './tarot-card';

interface RevealCardSequenceProps {
  children: ReactNode;
  faceUp: FaceUpCardProps;
  initialStep: PendingRevealStep;
  onCardRevealed?: () => void;
  onContentReachable?: () => void;
  width: number;
}

interface BurstParticleSpec {
  angle: number;
  distance: number;
  glyph: string;
  size: number;
  spin: number;
}

const burstParticles: BurstParticleSpec[] = [
  { angle: -90, distance: 0.62, glyph: '✦', size: 20, spin: 30 },
  { angle: -45, distance: 0.7, glyph: '✧', size: 15, spin: -40 },
  { angle: 0, distance: 0.66, glyph: '✦', size: 17, spin: 25 },
  { angle: 45, distance: 0.72, glyph: '✧', size: 14, spin: -30 },
  { angle: 90, distance: 0.6, glyph: '✦', size: 18, spin: 35 },
  { angle: 135, distance: 0.7, glyph: '✧', size: 14, spin: -25 },
  { angle: 180, distance: 0.66, glyph: '✦', size: 16, spin: 40 },
  { angle: -135, distance: 0.72, glyph: '✧', size: 15, spin: -35 },
];

function BurstParticle({
  burst,
  spec,
  width,
}: {
  burst: SharedValue<number>;
  spec: BurstParticleSpec;
  width: number;
}) {
  const style = useAnimatedStyle(() => {
    const travel = burst.value;
    const radians = (spec.angle * Math.PI) / 180;
    const distance = width * spec.distance * travel;

    return {
      opacity: interpolate(travel, [0, 0.08, 0.6, 1], [0, 1, 0.85, 0]),
      transform: [
        { translateX: Math.cos(radians) * distance },
        { translateY: Math.sin(radians) * distance },
        { scale: interpolate(travel, [0, 0.12, 1], [0.2, 1, 0.5]) },
        { rotate: `${String(travel * spec.spin)}deg` },
      ],
    };
  });

  return (
    <Animated.View style={[styles.particle, style]}>
      <AppText color="gold" style={[styles.particleGlyph, { fontSize: spec.size }]}>
        {spec.glyph}
      </AppText>
    </Animated.View>
  );
}

export function RevealCardSequence({
  children,
  faceUp,
  initialStep,
  onCardRevealed,
  onContentReachable,
  width,
}: RevealCardSequenceProps) {
  const systemReduceMotion = useReducedMotion();
  const feedback = useExperienceFeedback();
  const { reduceMoreMotion } = useMotionPreference();
  const reduceMotion = shouldReduceMotion(systemReduceMotion, reduceMoreMotion);
  const motionProfile = useMemo(() => getRevealMotionProfile(reduceMotion), [reduceMotion]);
  const recovery = useMemo(() => getRevealRecoveryBoundary(initialStep), [initialStep]);
  const cardProgress = useSharedValue(recovery.cardAccessible ? 1 : 0);
  const contentOpacity = useSharedValue(recovery.contentAccessible ? 1 : 0);
  const settlePop = useSharedValue(1);
  const sheen = useSharedValue(0);
  const burst = useSharedValue(0);
  const [cardAccessible, setCardAccessible] = useState(recovery.cardAccessible);
  const [contentAccessible, setContentAccessible] = useState(recovery.contentAccessible);
  const cardNotificationSent = useRef(false);
  const contentNotificationSent = useRef(false);
  const onCardRevealedRef = useRef(onCardRevealed);
  const onContentReachableRef = useRef(onContentReachable);

  useEffect(() => {
    onCardRevealedRef.current = onCardRevealed;
    onContentReachableRef.current = onContentReachable;
  }, [onCardRevealed, onContentReachable]);

  useEffect(() => {
    if (cardAccessible && !cardNotificationSent.current) {
      cardNotificationSent.current = true;
      if (recovery.animateCard) {
        feedback.cardRevealed();
      }
      onCardRevealedRef.current?.();
    }
  }, [cardAccessible, feedback, recovery.animateCard]);

  useEffect(() => {
    if (contentAccessible && !contentNotificationSent.current) {
      contentNotificationSent.current = true;
      onContentReachableRef.current?.();
    }
  }, [contentAccessible]);

  useEffect(() => {
    cardProgress.value = recovery.animateCard ? 0 : 1;
    contentOpacity.value = recovery.animateContent ? 0 : 1;
    settlePop.value = 1;
    sheen.value = 0;
    burst.value = 0;
    setCardAccessible(recovery.cardAccessible);
    setContentAccessible(recovery.contentAccessible);

    if (!recovery.animateContent) {
      return;
    }

    const revealContent = (delayMs: number) => {
      'worklet';
      contentOpacity.value = withDelay(
        delayMs,
        withTiming(
          1,
          { duration: motionProfile.contentDurationMs, easing: Easing.out(Easing.cubic) },
          (contentFinished) => {
            if (contentFinished) {
              scheduleOnRN(setContentAccessible, true);
            }
          },
        ),
      );
    };

    if (!recovery.animateCard) {
      revealContent(0);
      return;
    }

    cardProgress.value = withTiming(
      1,
      { duration: motionProfile.cardDurationMs, easing: Easing.inOut(Easing.cubic) },
      (finished) => {
        if (!finished) {
          return;
        }
        scheduleOnRN(setCardAccessible, true);
        if (motionProfile.flourishes) {
          settlePop.value = 1.055;
          settlePop.value = withSpring(1, { damping: 9, mass: 0.6, stiffness: 240 });
          sheen.value = withDelay(
            motionProfile.sheenDelayMs,
            withTiming(1, {
              duration: motionProfile.sheenDurationMs,
              easing: Easing.out(Easing.cubic),
            }),
          );
          burst.value = withTiming(1, {
            duration: motionProfile.burstDurationMs,
            easing: Easing.out(Easing.quad),
          });
        }
        revealContent(motionProfile.contentDelayMs);
      },
    );
  }, [burst, cardProgress, contentOpacity, motionProfile, recovery, settlePop, sheen]);

  const stageStyle = useAnimatedStyle(() => {
    if (reduceMotion) {
      return {};
    }

    return {
      transform: [
        { translateY: interpolate(cardProgress.value, [0, 0.5, 1], [0, -16, 0]) },
        { scale: interpolate(cardProgress.value, [0, 0.5, 1], [1, 1.08, 1]) },
      ],
    };
  });

  const auraStyle = useAnimatedStyle(() => {
    if (reduceMotion) {
      return { opacity: 0 };
    }

    return {
      opacity: interpolate(
        cardProgress.value,
        [0, 0.3, 0.5, 0.75, 1],
        [0.1, 0.32, 0.6, 0.34, 0.16],
      ),
    };
  });

  const cardBackStyle = useAnimatedStyle(() => {
    if (reduceMotion) {
      return { opacity: 1 - cardProgress.value };
    }

    return {
      opacity: cardProgress.value < 0.5 ? 1 : 0,
      transform: [
        { perspective: 1200 },
        { rotateY: `${String(interpolate(cardProgress.value, [0, 1], [0, 180]))}deg` },
      ],
    };
  });

  const cardFaceStyle = useAnimatedStyle(() => {
    if (reduceMotion) {
      return { opacity: cardProgress.value };
    }

    return {
      opacity: cardProgress.value >= 0.5 ? 1 : 0,
      transform: [
        { perspective: 1200 },
        { rotateY: `${String(interpolate(cardProgress.value, [0, 1], [-180, 0]))}deg` },
        { scale: settlePop.value },
      ],
    };
  });

  const sheenStyle = useAnimatedStyle(() => ({
    opacity: interpolate(sheen.value, [0, 0.08, 0.85, 1], [0, 1, 1, 0]),
    transform: [
      { translateX: interpolate(sheen.value, [0, 1], [-width * 0.55, width * 1.15]) },
      { rotate: '18deg' },
    ],
  }));

  const contentStyle = useAnimatedStyle(() => ({
    opacity: contentOpacity.value,
    transform: [
      {
        translateY: interpolate(contentOpacity.value, [0, 1], [motionProfile.contentTravel, 0]),
      },
    ],
  }));

  return (
    <>
      <Animated.View style={[styles.cardStage, { height: width * 1.5, width }, stageStyle]}>
        <Animated.View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          pointerEvents="none"
          style={[styles.aura, auraStyle]}
        />
        <Animated.View
          accessibilityElementsHidden={cardAccessible}
          importantForAccessibility={cardAccessible ? 'no-hide-descendants' : 'auto'}
          style={[styles.cardLayer, cardBackStyle]}
        >
          <TarotCard accessibilityLabel="Revealing your card." face="down" width={width} />
        </Animated.View>
        <Animated.View
          accessibilityElementsHidden={!cardAccessible}
          importantForAccessibility={cardAccessible ? 'auto' : 'no-hide-descendants'}
          style={[styles.cardLayer, cardFaceStyle]}
        >
          <TarotCard face="up" faceUp={faceUp} width={width} />
        </Animated.View>
        {motionProfile.flourishes ? (
          <>
            <View pointerEvents="none" style={styles.sheenMask}>
              <Animated.View style={[styles.sheenBand, sheenStyle]}>
                <View style={[styles.sheenLayer, styles.sheenWide]} />
                <View style={[styles.sheenLayer, styles.sheenMid]} />
                <View style={[styles.sheenLayer, styles.sheenCore]} />
              </Animated.View>
            </View>
            <View
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              pointerEvents="none"
              style={styles.burstStage}
            >
              {burstParticles.map((spec) => (
                <BurstParticle
                  burst={burst}
                  key={`${String(spec.angle)}-${spec.glyph}`}
                  spec={spec}
                  width={width}
                />
              ))}
            </View>
          </>
        ) : null}
      </Animated.View>

      <Animated.View
        accessibilityLiveRegion="polite"
        accessibilityElementsHidden={!contentAccessible}
        importantForAccessibility={contentAccessible ? 'auto' : 'no-hide-descendants'}
        style={[styles.content, contentStyle]}
      >
        {children}
      </Animated.View>
    </>
  );
}

const sheenTint = (opacity: number) => `rgba(244, 233, 210, ${String(opacity)})`;

const styles = StyleSheet.create({
  cardStage: {
    alignSelf: 'center',
    marginBottom: spacing.xl,
  },
  cardLayer: {
    position: 'absolute',
    inset: 0,
    backfaceVisibility: 'hidden',
  },
  aura: {
    position: 'absolute',
    inset: -spacing.lg,
    borderRadius: radii.card + spacing.lg,
    backgroundColor: colors.amethyst,
    shadowColor: colors.gold,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 36,
  },
  sheenMask: {
    position: 'absolute',
    inset: 0,
    overflow: 'hidden',
    borderRadius: radii.card,
  },
  sheenBand: {
    position: 'absolute',
    top: '-25%',
    bottom: '-25%',
    left: 0,
    width: 140,
    alignItems: 'center',
  },
  sheenLayer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
  },
  sheenWide: {
    width: 140,
    backgroundColor: sheenTint(0.05),
  },
  sheenMid: {
    width: 76,
    backgroundColor: sheenTint(0.09),
  },
  sheenCore: {
    width: 28,
    backgroundColor: sheenTint(0.2),
  },
  burstStage: {
    position: 'absolute',
    inset: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  particle: {
    position: 'absolute',
  },
  particleGlyph: {
    textShadowColor: colors.gold,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 8,
  },
  content: {
    gap: spacing.lg,
  },
});
