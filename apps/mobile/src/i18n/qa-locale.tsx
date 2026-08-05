import { createContext, type ReactNode, useContext, useMemo, useState } from 'react';

import { isPseudoLocaleAvailable, type QaLocale, resolveInitialQaLocale } from './pseudo';

interface QaLocaleContextValue {
  locale: QaLocale;
  pseudoLocaleAvailable: boolean;
  setLocale: (locale: QaLocale) => void;
}

const pseudoLocaleAvailable = isPseudoLocaleAvailable();
const initialLocale = resolveInitialQaLocale();

const QaLocaleContext = createContext<QaLocaleContextValue>({
  locale: initialLocale,
  pseudoLocaleAvailable,
  setLocale: () => undefined,
});

interface QaLocaleProviderProps {
  children: ReactNode;
}

export function QaLocaleProvider({ children }: QaLocaleProviderProps) {
  const [locale, setLocaleState] = useState<QaLocale>(initialLocale);
  const value = useMemo<QaLocaleContextValue>(
    () => ({
      locale,
      pseudoLocaleAvailable,
      setLocale: (nextLocale) => {
        setLocaleState(pseudoLocaleAvailable ? nextLocale : 'en');
      },
    }),
    [locale],
  );

  return <QaLocaleContext.Provider value={value}>{children}</QaLocaleContext.Provider>;
}

export function useQaLocale(): QaLocaleContextValue {
  return useContext(QaLocaleContext);
}
