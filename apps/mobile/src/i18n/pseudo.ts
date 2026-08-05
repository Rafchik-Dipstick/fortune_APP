export type QaLocale = 'en' | 'en-XA';

export function isPseudoLocaleAvailable(
  enabled = process.env.EXPO_PUBLIC_ENABLE_PSEUDO_LOCALE,
): boolean {
  return enabled === 'true';
}

export function resolveInitialQaLocale(
  enabled = process.env.EXPO_PUBLIC_ENABLE_PSEUDO_LOCALE,
  localeOverride = process.env.EXPO_PUBLIC_LOCALE_OVERRIDE,
): QaLocale {
  return isPseudoLocaleAvailable(enabled) && localeOverride?.toLowerCase() === 'en-xa'
    ? 'en-XA'
    : 'en';
}

export function pseudoLocalize(value: string, enabled = false): string {
  if (!enabled) {
    return value;
  }

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
