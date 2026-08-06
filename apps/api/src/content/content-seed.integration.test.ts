import { randomUUID } from 'node:crypto';

import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, describe, expect, it } from 'vitest';
import {
  developmentContentManifest,
  validateDevelopmentSlice,
  type ContentManifest,
} from '@fortuneness/fortune-content';

import { PrismaClient } from '../generated/prisma/client.js';
import { type AuthenticationContext } from '../middleware/authentication.js';
import { FortuneDrawService } from '../fortune/draw.js';
import { seedContent } from './content-seed.js';

const databaseUrl = process.env['TEST_DATABASE_URL'];
if (databaseUrl === undefined || databaseUrl.trim().length === 0) {
  throw new Error('TEST_DATABASE_URL is required for database integration tests.');
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const draws = new FortuneDrawService({ client: prisma });
const baseManifest = validateDevelopmentSlice(developmentContentManifest);

afterAll(async () => {
  // Restore the shipped development slice so the shared test database is left
  // exactly as the seeding step created it.
  await seedContent(prisma, { deckCards: baseManifest.cards, manifest: baseManifest });
  await prisma.$disconnect();
});

/** Rewrites every shipped word and stamps a new content version. */
function nextRelease(manifest: ContentManifest, contentVersion: string): ContentManifest {
  return {
    ...manifest,
    contentVersion,
    cards: manifest.cards.map((card) => ({ ...card })),
    templates: manifest.templates.map((template) => ({
      ...template,
      contentVersion,
      headline: `Revised ${template.headline}`,
      message: `Revised release copy. ${template.message}`,
      action: `Revised: ${template.action}`,
      affirmation: `Revised: ${template.affirmation}`,
    })),
  };
}

async function createDrawingUser(): Promise<AuthenticationContext> {
  const now = new Date();
  const financialSubject = await prisma.financialSubject.create({ data: {} });
  const user = await prisma.user.create({
    data: { accountTimeZone: 'UTC', activeFinancialSubjectId: financialSubject.id },
  });
  const authTimeSeconds = Math.floor(now.getTime() / 1_000);
  const family = await prisma.sessionFamily.create({
    data: {
      userId: user.id,
      sessionVersion: user.sessionVersion,
      gameCenterAuthenticatedAt: new Date(authTimeSeconds * 1_000),
      expiresAt: new Date(now.getTime() + 30 * 86_400_000),
    },
  });
  return {
    userId: user.id,
    sessionFamilyId: family.id,
    sessionVersion: user.sessionVersion,
    authTimeSeconds,
    authTime: new Date(authTimeSeconds * 1_000),
  };
}

describe('versioned content seed', () => {
  it('never rewrites a reading a player already received', async () => {
    const authentication = await createDrawingUser();
    const issued = await draws.draw(authentication, { intention: 'GENERAL' }, randomUUID());
    const drawId = issued.response.draw.id;
    const before = await prisma.fortuneDraw.findUniqueOrThrow({ where: { id: drawId } });

    const releaseVersion = `phase11-test-${randomUUID().slice(0, 8)}`;
    const summary = await seedContent(prisma, {
      deckCards: baseManifest.cards,
      manifest: nextRelease(baseManifest, releaseVersion),
    });

    expect(summary.contentVersion).toBe(releaseVersion);
    expect(summary.supersededVersions).toContain(baseManifest.contentVersion);

    const after = await prisma.fortuneDraw.findUniqueOrThrow({ where: { id: drawId } });
    expect({
      cardKey: after.cardKey,
      templateId: after.templateId,
      cardNameSnapshot: after.cardNameSnapshot,
      illustrationAltSnapshot: after.illustrationAltSnapshot,
      headlineSnapshot: after.headlineSnapshot,
      messageSnapshot: after.messageSnapshot,
      gentleActionSnapshot: after.gentleActionSnapshot,
      affirmationSnapshot: after.affirmationSnapshot,
      contentVersionSnapshot: after.contentVersionSnapshot,
    }).toEqual({
      cardKey: before.cardKey,
      templateId: before.templateId,
      cardNameSnapshot: before.cardNameSnapshot,
      illustrationAltSnapshot: before.illustrationAltSnapshot,
      headlineSnapshot: before.headlineSnapshot,
      messageSnapshot: before.messageSnapshot,
      gentleActionSnapshot: before.gentleActionSnapshot,
      affirmationSnapshot: before.affirmationSnapshot,
      contentVersionSnapshot: before.contentVersionSnapshot,
    });
    expect(after.contentVersionSnapshot).toBe(baseManifest.contentVersion);
  });

  it('retires the superseded release without editing or deleting its rows', async () => {
    const releaseVersion = `phase11-test-${randomUUID().slice(0, 8)}`;
    const previous = await prisma.fortuneTemplate.findMany({
      where: { contentVersion: baseManifest.contentVersion },
      orderBy: { id: 'asc' },
    });
    expect(previous.length).toBeGreaterThan(0);

    await seedContent(prisma, {
      deckCards: baseManifest.cards,
      manifest: nextRelease(baseManifest, releaseVersion),
    });

    const retained = await prisma.fortuneTemplate.findMany({
      where: { contentVersion: baseManifest.contentVersion },
      orderBy: { id: 'asc' },
    });
    expect(retained).toHaveLength(previous.length);
    for (const [index, template] of retained.entries()) {
      const original = previous[index];
      expect(original).toBeDefined();
      expect({
        id: template.id,
        headline: template.headline,
        message: template.message,
        gentleAction: template.gentleAction,
        affirmation: template.affirmation,
      }).toEqual({
        id: original?.id,
        headline: original?.headline,
        message: original?.message,
        gentleAction: original?.gentleAction,
        affirmation: original?.affirmation,
      });
      // Only selectability changes when a newer release lands.
      expect(template.active).toBe(false);
    }

    const active = await prisma.fortuneTemplate.findMany({
      where: { active: true },
      distinct: ['contentVersion'],
      select: { contentVersion: true },
    });
    expect(active.map(({ contentVersion }) => contentVersion)).toEqual([releaseVersion]);
  });

  it('is idempotent for the same release and reports a stable checksum', async () => {
    const releaseVersion = `phase11-test-${randomUUID().slice(0, 8)}`;
    const release = nextRelease(baseManifest, releaseVersion);

    const first = await seedContent(prisma, { deckCards: baseManifest.cards, manifest: release });
    const rowsAfterFirst = await prisma.fortuneTemplate.count({
      where: { contentVersion: releaseVersion },
    });
    const second = await seedContent(prisma, { deckCards: baseManifest.cards, manifest: release });

    expect(second.contentChecksum).toBe(first.contentChecksum);
    expect(await prisma.fortuneTemplate.count({ where: { contentVersion: releaseVersion } })).toBe(
      rowsAfterFirst,
    );
    expect(second.supersededVersions).toEqual([]);
  });

  it('refuses a manifest whose templates carry a different content version', async () => {
    const mismatched: ContentManifest = {
      ...baseManifest,
      contentVersion: 'phase11-mismatch',
    };

    await expect(
      seedContent(prisma, { deckCards: baseManifest.cards, manifest: mismatched }),
    ).rejects.toThrow(/content version/iu);
  });
});
