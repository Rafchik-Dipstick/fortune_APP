import { z } from 'zod';

export const launchLocales = ['en'] as const;

export const contentManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    contentVersion: z.string().min(1),
    locales: z.array(z.enum(launchLocales)).min(1),
    cards: z.array(
      z
        .object({
          key: z.string().min(1),
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((manifest, context) => {
    const keys = new Set<string>();
    for (const [index, card] of manifest.cards.entries()) {
      if (keys.has(card.key)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate card key: ${card.key}`,
          path: ['cards', index, 'key'],
        });
      }
      keys.add(card.key);
    }
  });

export const scaffoldContentManifest = {
  schemaVersion: 1,
  contentVersion: 'scaffold-2026-08-05',
  locales: ['en'],
  cards: [],
} as const;

export type ContentManifest = z.infer<typeof contentManifestSchema>;
