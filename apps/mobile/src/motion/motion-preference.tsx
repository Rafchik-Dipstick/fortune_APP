import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';

import { useAuthentication } from '../auth/authentication';

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
  const authentication = useAuthentication();
  const preferred = authentication.session?.user.preferences.reduceMotionPreferred ?? false;
  const accountId = authentication.session?.user.id;
  const [reduceMoreMotion, setReduceMoreMotion] = useState(preferred);
  useEffect(() => {
    setReduceMoreMotion(preferred);
  }, [accountId, preferred]);
  const value = useMemo(() => ({ reduceMoreMotion, setReduceMoreMotion }), [reduceMoreMotion]);

  return (
    <MotionPreferenceContext.Provider value={value}>{children}</MotionPreferenceContext.Provider>
  );
}

export function useMotionPreference(): MotionPreferenceContextValue {
  return useContext(MotionPreferenceContext);
}
