import type { ContentManifest, FortuneTemplate } from './schema.js';
import { countWords } from './schema.js';

const orientationOrder: readonly FortuneTemplate['orientation'][] = ['UPRIGHT', 'REVERSED'];
const intentionOrder: readonly FortuneTemplate['intention'][] = [
  'GENERAL',
  'LOVE',
  'WORK',
  'GROWTH',
];

function titleCase(value: string): string {
  return value.charAt(0) + value.slice(1).toLocaleLowerCase('en');
}

function singleLine(value: string): string {
  return value.replace(/\s+/gu, ' ').trim();
}

export function getTemplateReviewKey(template: FortuneTemplate): string {
  return [
    template.cardKey,
    template.orientation,
    template.intention,
    String(template.variant),
  ].join(':');
}

export function renderEditorialReviewMarkdown(manifest: ContentManifest): string {
  const lines: string[] = [
    '# Fortuneness Phase 2 editorial review packet',
    '',
    `Content version: \`${manifest.contentVersion}\``,
    '',
    `Scope: ${String(manifest.cards.length)} cards, ${String(manifest.templates.length)} English templates`,
    '',
    '> Generated from canonical content. This packet records no approval by itself.',
    '',
  ];

  const cards = [...manifest.cards].sort((left, right) => left.sortOrder - right.sortOrder);

  for (const card of cards) {
    lines.push(
      `## ${singleLine(card.localizedName.en)} (\`${card.key}\`)`,
      '',
      `- **Role:** ${card.sliceRole}`,
      `- **Card status:** ${card.editorialStatus}`,
      `- **Alternative text:** ${singleLine(card.localizedAltText.en)} (${String(countWords(card.localizedAltText.en))} words)`,
      `- **Illustration description:** ${singleLine(card.localizedIllustrationDescription.en)}`,
      '',
    );

    const templates = manifest.templates
      .filter((template) => template.cardKey === card.key)
      .sort((left, right) => {
        const orientationDifference =
          orientationOrder.indexOf(left.orientation) - orientationOrder.indexOf(right.orientation);
        if (orientationDifference !== 0) {
          return orientationDifference;
        }

        const intentionDifference =
          intentionOrder.indexOf(left.intention) - intentionOrder.indexOf(right.intention);
        return intentionDifference !== 0 ? intentionDifference : left.variant - right.variant;
      });

    for (const template of templates) {
      lines.push(
        `### ${titleCase(template.orientation)} · ${titleCase(template.intention)} · Variant ${String(template.variant)}`,
        '',
        `- **Review key:** \`${getTemplateReviewKey(template)}\``,
        `- **Template status:** ${template.editorialStatus}`,
        `- **Headline:** ${singleLine(template.headline)}`,
        `- **Message (${String(countWords(template.message))} words):** ${singleLine(template.message)}`,
        `- **Action (${String(countWords(template.action))} words):** ${singleLine(template.action)}`,
        `- **Affirmation:** ${singleLine(template.affirmation)}`,
        '- **Reviewer decision:** APPROVE / REVISE',
        '- **Reviewer notes:**',
        '',
      );
    }
  }

  return `${lines.join('\n').trim()}\n`;
}
