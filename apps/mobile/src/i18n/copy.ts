import { pseudoLocalize } from './pseudo';

const englishCopy = {
  eyebrow: 'Daily reflection',
  title: 'Fortuneness',
  headline: 'The Oracle is taking shape.',
  body: 'This development build confirms the iPhone and iPad foundation. The first card ritual arrives in the next visual phase.',
  status: 'Phase 1 scaffold',
} as const;

type AppCopy = { [Key in keyof typeof englishCopy]: string };

export function getAppCopy(localeOverride: string | undefined): AppCopy {
  const pseudoLocaleEnabled = process.env.EXPO_PUBLIC_ENABLE_PSEUDO_LOCALE === 'true';
  const usePseudoLocale = pseudoLocaleEnabled && localeOverride?.toLowerCase() === 'en-xa';

  if (!usePseudoLocale) {
    return englishCopy;
  }

  return Object.fromEntries(
    Object.entries(englishCopy).map(([key, value]) => [key, pseudoLocalize(value)]),
  ) as AppCopy;
}
