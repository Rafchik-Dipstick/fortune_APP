import { Children, type ReactNode } from 'react';
import { StyleSheet, Text, type TextProps, type TextStyle } from 'react-native';

import { useQaLocale } from '@/i18n/qa-locale';
import { pseudoLocalize } from '@/i18n/pseudo';
import { colors, typography } from '@/theme/tokens';

type TextVariant = 'display' | 'title' | 'headline' | 'body' | 'label' | 'caption';

type AppTextProps = Omit<TextProps, 'children'> & {
  children: ReactNode;
  color?: keyof Pick<typeof colors, 'text' | 'textMuted' | 'gold' | 'danger'>;
  variant?: TextVariant;
};

function localizeTextNodes(children: ReactNode, pseudoLocaleEnabled: boolean): ReactNode {
  if (typeof children === 'string') {
    return pseudoLocalize(children, pseudoLocaleEnabled);
  }

  return Children.map(children, (child) =>
    typeof child === 'string' ? pseudoLocalize(child, pseudoLocaleEnabled) : child,
  );
}

export function AppText({
  children,
  color = 'text',
  style,
  variant = 'body',
  ...textProps
}: AppTextProps) {
  const { locale } = useQaLocale();
  const localizedChildren = localizeTextNodes(children, locale === 'en-XA');

  return (
    <Text
      {...textProps}
      style={[styles.base, variantStyles[variant], { color: colors[color] }, style]}
    >
      {localizedChildren}
    </Text>
  );
}

const styles = StyleSheet.create({
  base: {
    fontFamily: typography.bodyFamily,
    textAlign: 'left',
  },
});

const variantStyles = StyleSheet.create<Record<TextVariant, TextStyle>>({
  display: {
    fontFamily: typography.displayFamily,
    fontSize: 40,
    fontWeight: '600',
    lineHeight: 48,
  },
  title: {
    fontFamily: typography.displayFamily,
    fontSize: 30,
    fontWeight: '600',
    lineHeight: 38,
  },
  headline: {
    fontFamily: typography.displayFamily,
    fontSize: 24,
    fontWeight: '500',
    lineHeight: 32,
  },
  body: {
    fontSize: 17,
    lineHeight: 26,
  },
  label: {
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 20,
  },
  caption: {
    fontSize: 13,
    lineHeight: 18,
  },
});
