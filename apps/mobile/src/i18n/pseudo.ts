export function pseudoLocalize(value: string): string {
  const pseudoLocaleEnabled = process.env.EXPO_PUBLIC_ENABLE_PSEUDO_LOCALE === 'true';
  const localeOverride = process.env.EXPO_PUBLIC_LOCALE_OVERRIDE?.toLowerCase();
  if (!pseudoLocaleEnabled || localeOverride !== 'en-xa') {
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
