import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { useMotionPreference } from '@/motion/motion-preference';
import { shouldReduceMotion } from '@/motion/reduce-motion';
import { getRevealMotionProfile } from '@/motion/reveal-motion';
import { getRevealRecoveryBoundary } from '@/motion/reveal-recovery';
import type { PendingRevealStep } from '@/local-data/reading-store';
import { useExperienceFeedback } from '@/feedback/experience-feedback';
import { spacing } from '@/theme/tokens';

import { TarotCard, type FaceUpCardProps } from './tarot-card';

interface RevealCardSequenceProps {
  children: ReactNode;
  faceUp: FaceUpCardProps;
  initialStep: PendingRevealStep;
  onCardRevealed?: () => void;
  onContentReachable?: () => void;
  width: number;
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
    setCardAccessible(recovery.cardAccessible);
    setContentAccessible(recovery.contentAccessible);

    if (!recovery.animateContent) {
      return;
    }

    const revealContent = (delayMs: number) => {
      'worklet';
      contentOpacity.value = withDelay(
        delayMs,
        withTiming(1, { duration: motionProfile.contentDurationMs }, (contentFinished) => {
          if (contentFinished) {
            scheduleOnRN(setContentAccessible, true);
          }
        }),
      );
    };

    if (!recovery.animateCard) {
      revealContent(0);
      return;
    }

    cardProgress.value = withTiming(1, { duration: motionProfile.cardDurationMs }, (finished) => {
      if (!finished) {
        return;
      }
      scheduleOnRN(setCardAccessible, true);
      revealContent(motionProfile.contentDelayMs);
    });
  }, [cardProgress, contentOpacity, motionProfile, recovery]);

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
      ],
    };
  });

  const contentStyle = useAnimatedStyle(() => ({ opacity: contentOpacity.value }));

  return (
    <>
      <View style={[styles.cardStage, { height: width * 1.5, width }]}>
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
      </View>

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
  content: {
    gap: spacing.lg,
  },
});
