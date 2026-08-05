export const arcana = ['MAJOR', 'MINOR'] as const;
export const tarotSuits = ['WANDS', 'CUPS', 'SWORDS', 'PENTACLES'] as const;
export const orientations = ['UPRIGHT', 'REVERSED'] as const;
export const fortuneIntentions = ['GENERAL', 'LOVE', 'WORK', 'GROWTH'] as const;
export const allowanceSources = ['FREE_DAILY', 'SUBSCRIPTION_DAILY', 'PACK_CREDIT'] as const;

export type Arcana = (typeof arcana)[number];
export type TarotSuit = (typeof tarotSuits)[number];
export type Orientation = (typeof orientations)[number];
export type FortuneIntention = (typeof fortuneIntentions)[number];
export type AllowanceSource = (typeof allowanceSources)[number];
