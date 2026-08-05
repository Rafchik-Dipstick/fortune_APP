import { z } from 'zod';

export const launchLocales = ['en'] as const;
const orientations = ['UPRIGHT', 'REVERSED'] as const;
const intentions = ['GENERAL', 'LOVE', 'WORK', 'GROWTH'] as const;

export const developmentSliceExpectations = {
  cards: 3,
  illustrationDescriptions: 3,
  templates: 24,
} as const;

export function countWords(value: string): number {
  return value.trim().split(/\s+/u).filter(Boolean).length;
}

function wordBoundedString(label: string, minimum: number, maximum: number) {
  return z
    .string()
    .trim()
    .min(1)
    .refine((value) => countWords(value) >= minimum && countWords(value) <= maximum, {
      message: `${label} must contain ${String(minimum)}–${String(maximum)} words.`,
    });
}

const localizedNameSchema = z
  .object({
    en: wordBoundedString('English card name', 1, 6),
  })
  .strict();

const localizedAltTextSchema = z
  .object({
    en: wordBoundedString('English alternative text', 8, 25),
  })
  .strict();

const localizedIllustrationDescriptionSchema = z
  .object({
    en: wordBoundedString('English illustration description', 8, 40),
  })
  .strict();

const tarotCardSchema = z
  .object({
    key: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
    displayNumber: z.string().trim().min(1).max(8),
    arcana: z.enum(['MAJOR', 'MINOR']),
    sliceRole: z.enum(['MAJOR', 'COURT', 'PIP']),
    suit: z.enum(['WANDS', 'CUPS', 'SWORDS', 'PENTACLES']).optional(),
    rank: z.string().trim().min(1).max(16).optional(),
    assetKey: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
    localizedName: localizedNameSchema,
    localizedAltText: localizedAltTextSchema,
    localizedIllustrationDescription: localizedIllustrationDescriptionSchema,
    editorialStatus: z.enum(['DRAFT', 'READY_FOR_REVIEW', 'APPROVED']),
    sortOrder: z.number().int().nonnegative(),
    active: z.boolean(),
  })
  .strict();

const fortuneTemplateSchema = z
  .object({
    cardKey: z.string().min(1),
    locale: z.enum(launchLocales),
    orientation: z.enum(orientations),
    intention: z.enum(intentions),
    variant: z.number().int().positive(),
    headline: wordBoundedString('Headline', 3, 12),
    message: wordBoundedString('Message', 50, 100),
    action: wordBoundedString('Action', 10, 25),
    affirmation: wordBoundedString('Affirmation', 3, 16),
    contentVersion: z.string().min(1),
    editorialStatus: z.enum(['DRAFT', 'READY_FOR_REVIEW', 'APPROVED']),
    active: z.boolean(),
  })
  .strict();

const prohibitedPatterns: readonly { label: string; pattern: RegExp }[] = [
  {
    label: 'guaranteed or absolute outcome',
    pattern: /\b(guarantee(?:d)?|certainly|definitely|inevitable|destined to|no doubt)\b/iu,
  },
  {
    label: 'hidden-thought claim',
    pattern: /\b(they|he|she)\s+(secretly|certainly|definitely)\s+(thinks?|feels?|wants?)\b/iu,
  },
  {
    label: 'medical-treatment instruction',
    pattern: /\b(stop|skip|quit|change)\b.{0,40}\b(medication|medicine|treatment|therapy)\b/iu,
  },
  {
    label: 'financial transaction instruction',
    pattern: /\b(buy|sell|bet|gamble|invest)\b.{0,40}\b(stock|crypto|money|funds?|savings?)\b/iu,
  },
  {
    label: 'unsafe instruction',
    pattern: /\b(leave|ignore)\b.{0,40}\b(safe place|safety plan|warning|danger|abuse)\b/iu,
  },
  {
    label: 'punitive or doom framing',
    pattern: /\b(doom(?:ed)?|punishment|no hope|cannot escape)\b/iu,
  },
];

function normalizeCopy(value: string): string {
  return value
    .toLocaleLowerCase('en')
    .replace(/[^a-z0-9]+/gu, ' ')
    .trim();
}

export const contentManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    contentVersion: z.string().min(1),
    locales: z.array(z.enum(launchLocales)).min(1),
    cards: z.array(tarotCardSchema),
    templates: z.array(fortuneTemplateSchema),
  })
  .strict()
  .superRefine((manifest, context) => {
    const cardKeys = new Set<string>();
    const assetKeys = new Set<string>();

    for (const [index, card] of manifest.cards.entries()) {
      if (cardKeys.has(card.key)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate card key: ${card.key}`,
          path: ['cards', index, 'key'],
        });
      }
      cardKeys.add(card.key);

      if (assetKeys.has(card.assetKey)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate asset key: ${card.assetKey}`,
          path: ['cards', index, 'assetKey'],
        });
      }
      assetKeys.add(card.assetKey);
    }

    const logicalKeys = new Set<string>();
    const normalizedCopies = new Map<string, number>();

    for (const [index, template] of manifest.templates.entries()) {
      if (!cardKeys.has(template.cardKey)) {
        context.addIssue({
          code: 'custom',
          message: `Unknown card reference: ${template.cardKey}`,
          path: ['templates', index, 'cardKey'],
        });
      }

      const logicalKey = [
        template.cardKey,
        template.locale,
        template.orientation,
        template.intention,
        String(template.variant),
      ].join(':');
      if (logicalKeys.has(logicalKey)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate logical template key: ${logicalKey}`,
          path: ['templates', index],
        });
      }
      logicalKeys.add(logicalKey);

      const combinedCopy = normalizeCopy(
        [template.headline, template.message, template.action, template.affirmation].join(' '),
      );
      const previousIndex = normalizedCopies.get(combinedCopy);
      if (previousIndex !== undefined) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate normalized copy; first used by template ${String(previousIndex)}.`,
          path: ['templates', index],
        });
      }
      normalizedCopies.set(combinedCopy, index);

      for (const [field, value] of Object.entries({
        headline: template.headline,
        message: template.message,
        action: template.action,
        affirmation: template.affirmation,
      })) {
        for (const prohibited of prohibitedPatterns) {
          if (prohibited.pattern.test(value)) {
            context.addIssue({
              code: 'custom',
              message: `Contains prohibited ${prohibited.label} language.`,
              path: ['templates', index, field],
            });
          }
        }
      }
    }

    const manifestLocales: readonly string[] = manifest.locales;
    for (const card of manifest.cards.filter(({ active }) => active)) {
      for (const locale of manifestLocales) {
        for (const orientation of orientations) {
          for (const intention of intentions) {
            const hasActiveTemplate = manifest.templates.some(
              (template) =>
                template.active &&
                template.cardKey === card.key &&
                template.locale === locale &&
                template.orientation === orientation &&
                template.intention === intention,
            );

            if (!hasActiveTemplate) {
              context.addIssue({
                code: 'custom',
                message: `Missing active template for ${card.key}:${locale}:${orientation}:${intention}.`,
                path: ['templates'],
              });
            }
          }
        }
      }
    }
  });

export type ContentManifest = z.infer<typeof contentManifestSchema>;
export type FortuneTemplate = z.infer<typeof fortuneTemplateSchema>;
export type TarotCardContent = z.infer<typeof tarotCardSchema>;

export function validateDevelopmentSlice(value: unknown): ContentManifest {
  const manifest = contentManifestSchema.parse(value);
  const activeCards = manifest.cards.filter(({ active }) => active);
  const activeTemplates = manifest.templates.filter(({ active }) => active);

  if (activeCards.length !== developmentSliceExpectations.cards) {
    throw new Error(
      `Development slice requires ${String(developmentSliceExpectations.cards)} active cards; received ${String(activeCards.length)}.`,
    );
  }

  const roles = new Set(activeCards.map(({ sliceRole }) => sliceRole));
  for (const requiredRole of ['MAJOR', 'COURT', 'PIP'] as const) {
    if (!roles.has(requiredRole)) {
      throw new Error(`Development slice is missing its ${requiredRole.toLowerCase()} card.`);
    }
  }

  if (activeTemplates.length !== developmentSliceExpectations.templates) {
    throw new Error(
      `Development slice requires ${String(developmentSliceExpectations.templates)} active templates; received ${String(activeTemplates.length)}.`,
    );
  }

  return manifest;
}
