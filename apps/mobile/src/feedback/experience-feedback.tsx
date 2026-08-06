import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useAudioPlayer, type AudioPlayer } from 'expo-audio';
import * as Haptics from 'expo-haptics';

import paperDrawSound from '../../assets/audio/paper-draw.wav';
import revealShimmerSound from '../../assets/audio/reveal-shimmer.wav';
import { useAuthentication } from '../auth/authentication';

interface ExperienceFeedbackContextValue {
  hapticsEnabled: boolean;
  soundEnabled: boolean;
  cardRevealed: () => void;
  drawIssued: () => void;
  setHapticsEnabled: (enabled: boolean) => void;
  setSoundEnabled: (enabled: boolean) => void;
}

const ExperienceFeedbackContext = createContext<ExperienceFeedbackContextValue | undefined>(
  undefined,
);

async function replay(player: AudioPlayer): Promise<void> {
  await player.seekTo(0);
  player.play();
}

export function ExperienceFeedbackProvider({ children }: { children: ReactNode }) {
  const authentication = useAuthentication();
  if (authentication.phase !== 'AUTHENTICATED' || authentication.session === undefined) {
    throw new Error('ExperienceFeedbackProvider requires an authenticated session.');
  }
  const preferences = authentication.session.user.preferences;
  const accountId = authentication.session.user.id;
  const [soundEnabled, setSoundEnabled] = useState(preferences.soundEnabled);
  const [hapticsEnabled, setHapticsEnabled] = useState(preferences.hapticsEnabled);
  const drawPlayer = useAudioPlayer(paperDrawSound, {
    downloadFirst: true,
  });
  const revealPlayer = useAudioPlayer(revealShimmerSound, {
    downloadFirst: true,
  });

  useEffect(() => {
    setSoundEnabled(preferences.soundEnabled);
    setHapticsEnabled(preferences.hapticsEnabled);
  }, [accountId, preferences.hapticsEnabled, preferences.soundEnabled]);

  const drawIssued = useCallback(() => {
    if (soundEnabled) {
      void replay(drawPlayer).catch(() => undefined);
    }
    if (hapticsEnabled) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft).catch(() => undefined);
    }
  }, [drawPlayer, hapticsEnabled, soundEnabled]);

  const cardRevealed = useCallback(() => {
    if (soundEnabled) {
      void replay(revealPlayer).catch(() => undefined);
    }
    if (hapticsEnabled) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
        () => undefined,
      );
    }
  }, [hapticsEnabled, revealPlayer, soundEnabled]);

  const value = useMemo(
    () => ({
      drawIssued,
      cardRevealed,
      hapticsEnabled,
      setHapticsEnabled,
      setSoundEnabled,
      soundEnabled,
    }),
    [cardRevealed, drawIssued, hapticsEnabled, soundEnabled],
  );
  return (
    <ExperienceFeedbackContext.Provider value={value}>
      {children}
    </ExperienceFeedbackContext.Provider>
  );
}

export function useExperienceFeedback(): ExperienceFeedbackContextValue {
  const value = useContext(ExperienceFeedbackContext);
  if (value === undefined) {
    throw new Error('useExperienceFeedback must be used inside ExperienceFeedbackProvider.');
  }
  return value;
}
