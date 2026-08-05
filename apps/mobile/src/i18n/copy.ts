const englishCopy = {
  eyebrow: 'Daily reflection',
  title: 'Fortuneness',
  headline: 'The Oracle is taking shape.',
  body: 'This development build confirms the iPhone and iPad foundation. The first card ritual arrives in the next visual phase.',
  status: 'Phase 1 scaffold',
} as const;

type AppCopy = { [Key in keyof typeof englishCopy]: string };

function expandForPseudoLocale(value: string): string {
  const expanded = value
    .replaceAll('a', 'áá')
    .replaceAll('e', 'éé')
    .replaceAll('i', 'íí')
    .replaceAll('o', 'óó')
    .replaceAll('u', 'úú')
    .replaceAll('A', 'ÁÁ')
    .replaceAll('E', 'ÉÉ')
    .replaceAll('I', 'ÍÍ')
    .replaceAll('O', 'ÓÓ')
    .replaceAll('U', 'ÚÚ');

  return `⟦${expanded}⟧`;
}

export function getAppCopy(localeOverride: string | undefined): AppCopy {
  const pseudoLocaleEnabled = process.env.EXPO_PUBLIC_ENABLE_PSEUDO_LOCALE === 'true';
  const usePseudoLocale = pseudoLocaleEnabled && localeOverride?.toLowerCase() === 'en-xa';

  if (!usePseudoLocale) {
    return englishCopy;
  }

  return Object.fromEntries(
    Object.entries(englishCopy).map(([key, value]) => [key, expandForPseudoLocale(value)]),
  ) as AppCopy;
}
