import { createContext, type ReactNode, useContext, useMemo, useState } from 'react';

interface MotionPreferenceContextValue {
  reduceMoreMotion: boolean;
  setReduceMoreMotion: (enabled: boolean) => void;
}

const MotionPreferenceContext = createContext<MotionPreferenceContextValue>({
  reduceMoreMotion: false,
  setReduceMoreMotion: () => undefined,
});

interface MotionPreferenceProviderProps {
  children: ReactNode;
}

export function MotionPreferenceProvider({ children }: MotionPreferenceProviderProps) {
  const [reduceMoreMotion, setReduceMoreMotion] = useState(false);
  const value = useMemo(() => ({ reduceMoreMotion, setReduceMoreMotion }), [reduceMoreMotion]);

  return (
    <MotionPreferenceContext.Provider value={value}>{children}</MotionPreferenceContext.Provider>
  );
}

export function useMotionPreference(): MotionPreferenceContextValue {
  return useContext(MotionPreferenceContext);
}
