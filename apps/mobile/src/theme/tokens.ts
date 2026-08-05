export const colors = {
  background: '#0D0A1A',
  surface: '#171127',
  surfaceRaised: '#211735',
  gold: '#D4AF67',
  goldMuted: '#9C8151',
  text: '#F4EFE6',
  textMuted: '#B8AEC5',
  focus: '#C7B4FF',
  amethyst: '#75609B',
  teal: '#315F63',
  parchment: '#D8C7AE',
  danger: '#E7A6AD',
  transparent: 'transparent',
} as const;

export const spacing = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
  xxxl: 64,
} as const;

export const radii = {
  control: 14,
  surface: 20,
  card: 24,
  pill: 999,
} as const;

export const layout = {
  compactMax: 599,
  mediumMax: 899,
  contentMax: 1100,
  readingMax: 680,
  cardMax: 340,
  minimumTouchTarget: 44,
} as const;

export const typography = {
  displayFamily: 'Georgia',
  bodyFamily: undefined,
} as const;
