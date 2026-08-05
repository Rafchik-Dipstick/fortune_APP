import type { ImageSourcePropType } from 'react-native';

import type { Orientation } from '@fortuneness/shared-types';

import queenOfCupsIllustration from '../../../../tools/card-assets/normalized/cups-queen.png';
import theFoolIllustration from '../../../../tools/card-assets/normalized/major-00-fool.png';
import threeOfWandsIllustration from '../../../../tools/card-assets/normalized/wands-03.png';

export interface VerticalSliceCard {
  altText: string;
  arcana: 'MAJOR' | 'MINOR';
  illustration?: ImageSourcePropType;
  key: string;
  name: string;
  number: string;
  orientation: Orientation;
  suitSymbol: string;
}

function card(value: VerticalSliceCard): VerticalSliceCard {
  return value;
}

export const verticalSliceCards = [
  card({
    altText: 'A traveler steps toward dawn beneath a bright wandering star.',
    arcana: 'MAJOR',
    illustration: theFoolIllustration,
    key: 'major-00-fool',
    name: 'The Fool',
    number: '0',
    orientation: 'UPRIGHT',
    suitSymbol: '✦',
  }),
  card({
    altText: 'A calm queen holds a silver cup beside moonlit water and white lilies.',
    arcana: 'MINOR',
    illustration: queenOfCupsIllustration,
    key: 'cups-queen',
    name: 'Queen of Cups',
    number: 'Q',
    orientation: 'UPRIGHT',
    suitSymbol: '◡',
  }),
  card({
    altText: 'Three flowering staffs overlook a luminous sea beneath an open horizon.',
    arcana: 'MINOR',
    illustration: threeOfWandsIllustration,
    key: 'wands-03',
    name: 'Three of Wands',
    number: 'III',
    orientation: 'UPRIGHT',
    suitSymbol: '│',
  }),
] as const;

export const sampleReading = {
  ...verticalSliceCards[0],
  action: 'Choose one small beginning and give it ten honest minutes.',
  affirmation: 'I can meet the unknown with curiosity.',
  headline: 'Begin before certainty arrives',
  intention: 'Growth',
  message:
    'A beginning may be asking for your attention before every detail is settled. The Fool invites curiosity, preparation without paralysis, and a willingness to learn from the first honest step. Notice where uncertainty has become a reason to stay still. You do not need to promise an outcome; you may simply make room for discovery.',
} as const;
