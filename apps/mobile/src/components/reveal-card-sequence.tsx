import { useEffect, useMemo, useState, type ReactNode } from 'react';
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
import { spacing } from '@/theme/tokens';

import { TarotCard, type FaceUpCardProps } from './tarot-card';

interface RevealCardSequenceProps {
  children: ReactNode;
  faceUp: FaceUpCardProps;
  width: number;
}

export function RevealCardSequence({ children, faceUp, width }: RevealCardSequenceProps) {
  const systemReduceMotion = useReducedMotion();
  const { reduceMoreMotion } = useMotionPreference();
  const reduceMotion = shouldReduceMotion(systemReduceMotion, reduceMoreMotion);
  const motionProfile = useMemo(() => getRevealMotionProfile(reduceMotion), [reduceMotion]);
  const cardProgress = useSharedValue(0);
  const contentOpacity = useSharedValue(0);
  const [revealAccessible, setRevealAccessible] = useState(reduceMotion);

  useEffect(() => {
    cardProgress.value = 0;
    contentOpacity.value = 0;
    setRevealAccessible(reduceMotion);

    cardProgress.value = withTiming(1, { duration: motionProfile.cardDurationMs }, (finished) => {
      if (!finished) {
        return;
      }

      if (!reduceMotion) {
        scheduleOnRN(setRevealAccessible, true);
      }

      contentOpacity.value = withDelay(
        motionProfile.contentDelayMs,
        withTiming(1, { duration: motionProfile.contentDurationMs }),
      );
    });
  }, [cardProgress, contentOpacity, motionProfile, reduceMotion]);

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
          accessibilityElementsHidden={revealAccessible}
          importantForAccessibility={revealAccessible ? 'no-hide-descendants' : 'auto'}
          style={[styles.cardLayer, cardBackStyle]}
        >
          <TarotCard accessibilityLabel="Revealing your card." face="down" width={width} />
        </Animated.View>
        <Animated.View
          accessibilityElementsHidden={!revealAccessible}
          importantForAccessibility={revealAccessible ? 'auto' : 'no-hide-descendants'}
          style={[styles.cardLayer, cardFaceStyle]}
        >
          <TarotCard face="up" faceUp={faceUp} width={width} />
        </Animated.View>
      </View>

      <Animated.View
        accessibilityLiveRegion="polite"
        importantForAccessibility={revealAccessible ? 'auto' : 'no-hide-descendants'}
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
