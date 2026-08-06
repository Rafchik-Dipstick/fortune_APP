import { randomUUID } from 'node:crypto';

import { PrismaPg } from '@prisma/adapter-pg';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';

import { createTestApiEnvironment } from '../config/environment.fixture.js';
import { PrismaClient } from '../generated/prisma/client.js';
import { type AuthenticationContext } from '../middleware/authentication.js';
import { FortuneArchiveError, FortuneArchiveService } from './archive.js';
import { CollectionError, CollectionService } from './collection.js';

const databaseUrl = process.env['TEST_DATABASE_URL'];
if (databaseUrl === undefined || databaseUrl.trim().length === 0) {
  throw new Error('TEST_DATABASE_URL is required for database integration tests.');
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
const cursorKeys = createTestApiEnvironment().archive.historyCursorHmacKeys;
const archive = new FortuneArchiveService(prisma, cursorKeys);
const collection = new CollectionService(prisma, cursorKeys);

interface ArchiveFixture {
  authentication: AuthenticationContext;
  periodId: string;
  userId: string;
}

type SeededTemplate = Awaited<ReturnType<typeof loadActiveTemplates>>[number];

async function loadActiveTemplates() {
  return prisma.fortuneTemplate.findMany({
    where: { active: true },
    include: { card: true },
    orderBy: [{ cardKey: 'asc' }, { orientation: 'asc' }, { intention: 'asc' }],
  });
}

async function createArchiveFixture(now = new Date()): Promise<ArchiveFixture> {
  const financialSubject = await prisma.financialSubject.create({ data: {} });
  const user = await prisma.user.create({
    data: { accountTimeZone: 'UTC', activeFinancialSubjectId: financialSubject.id },
  });
  const period = await prisma.allowancePeriod.create({
    data: {
      userId: user.id,
      sequence: 1n,
      startedAt: new Date(now.getTime() - 86_400_000 * 400),
      resetAt: new Date(now.getTime() + 86_400_000),
      timeZoneSnapshot: 'UTC',
    },
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
    periodId: period.id,
    userId: user.id,
    authentication: {
      userId: user.id,
      sessionFamilyId: family.id,
      sessionVersion: user.sessionVersion,
      authTimeSeconds,
      authTime: new Date(authTimeSeconds * 1_000),
    },
  };
}

function drawRow(
  fixture: ArchiveFixture,
  template: SeededTemplate,
  sequence: number,
  issuedAt: Date,
) {
  return {
    userId: fixture.userId,
    cardKey: template.cardKey,
    templateId: template.id,
    allowancePeriodId: fixture.periodId,
    allowanceSource: 'FREE_DAILY' as const,
    intention: template.intention,
    orientation: template.orientation,
    resolvedLocale: template.locale,
    sequence: BigInt(sequence),
    cardDisplayNumber: template.card.displayNumber,
    cardNameSnapshot: template.card.nameEn,
    illustrationAltSnapshot: template.card.illustrationAltEn,
    headlineSnapshot: template.headline,
    messageSnapshot: template.message,
    gentleActionSnapshot: template.gentleAction,
    affirmationSnapshot: template.affirmation,
    contentVersionSnapshot: template.contentVersion,
    issuedAt,
    viewedAt: issuedAt,
    clientIdempotencyKey: randomUUID(),
    requestHash: 'a'.repeat(64),
  };
}

async function seedDraws(fixture: ArchiveFixture, count: number, baseTime: Date): Promise<void> {
  const templates = await loadActiveTemplates();
  const rows = Array.from({ length: count }, (_, index) => {
    const template = templates[index % templates.length];
    if (template === undefined) {
      throw new Error('The seeded development content is missing active templates.');
    }
    // Repeat each issuedAt across four draws so the id tie-breaker is exercised.
    const issuedAt = new Date(baseTime.getTime() - Math.floor(index / 4) * 1_000);
    return drawRow(fixture, template, index + 1, issuedAt);
  });
  for (let offset = 0; offset < rows.length; offset += 500) {
    await prisma.fortuneDraw.createMany({ data: rows.slice(offset, offset + 500) });
  }
}

beforeAll(async () => {
  await prisma.$queryRaw`SELECT 1`;
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('fortune archive service (integration)', () => {
  it('walks thousands of draws in stable order without duplicates, gaps, or oversized pages', async () => {
    const fixture = await createArchiveFixture();
    await seedDraws(fixture, 2_400, new Date('2026-08-06T10:00:00.000Z'));

    const seenIds: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    for (;;) {
      const page = await archive.list(fixture.authentication, {
        limit: 100,
        ...(cursor === undefined ? {} : { cursor }),
      });
      pages += 1;
      expect(page.items.length).toBeLessThanOrEqual(100);
      seenIds.push(...page.items.map((item) => item.id));
      if (page.nextCursor === null) {
        break;
      }
      cursor = page.nextCursor;
    }

    expect(pages).toBe(24);
    expect(seenIds).toHaveLength(2_400);
    expect(new Set(seenIds).size).toBe(2_400);
    const authoritative = await prisma.fortuneDraw.findMany({
      where: { userId: fixture.userId },
      orderBy: [{ issuedAt: 'desc' }, { id: 'desc' }],
      select: { id: true },
    });
    expect(seenIds).toEqual(authoritative.map((row) => row.id));
  }, 120_000);

  it('applies every filter combination consistently with the snapshot rows', async () => {
    const fixture = await createArchiveFixture();
    await seedDraws(fixture, 96, new Date('2026-08-06T10:00:00.000Z'));
    const rows = await prisma.fortuneDraw.findMany({
      where: { userId: fixture.userId },
      include: { card: true },
    });

    const byOrientation = await archive.list(fixture.authentication, {
      limit: 100,
      orientation: 'REVERSED',
    });
    expect(byOrientation.items).toHaveLength(
      rows.filter((row) => row.orientation === 'REVERSED').length,
    );
    expect(byOrientation.items.every((item) => item.orientation === 'REVERSED')).toBe(true);

    const byIntention = await archive.list(fixture.authentication, {
      intention: 'LOVE',
      limit: 100,
    });
    expect(byIntention.items).toHaveLength(rows.filter((row) => row.intention === 'LOVE').length);

    const byCard = await archive.list(fixture.authentication, {
      cardKey: 'cups-queen',
      limit: 100,
    });
    expect(byCard.items).toHaveLength(rows.filter((row) => row.cardKey === 'cups-queen').length);
    expect(byCard.items.every((item) => item.cardKey === 'cups-queen')).toBe(true);

    const byArcana = await archive.list(fixture.authentication, { arcana: 'MAJOR', limit: 100 });
    expect(byArcana.items).toHaveLength(rows.filter((row) => row.card.arcana === 'MAJOR').length);

    const bySuit = await archive.list(fixture.authentication, { limit: 100, suit: 'WANDS' });
    expect(bySuit.items).toHaveLength(rows.filter((row) => row.card.suit === 'WANDS').length);

    const issuedFrom = '2026-08-06T09:59:55.000Z';
    const byRange = await archive.list(fixture.authentication, { issuedFrom, limit: 100 });
    expect(byRange.items).toHaveLength(
      rows.filter((row) => row.issuedAt >= new Date(issuedFrom)).length,
    );
  }, 60_000);

  it('rejects cursors that were tampered with or rebound to another user, filter, or route', async () => {
    const owner = await createArchiveFixture();
    const other = await createArchiveFixture();
    await seedDraws(owner, 8, new Date('2026-08-06T10:00:00.000Z'));
    const first = await archive.list(owner.authentication, { limit: 4 });
    const cursor = first.nextCursor;
    if (cursor === null) {
      throw new Error('Expected a second archive page.');
    }

    await expect(archive.list(other.authentication, { cursor, limit: 4 })).rejects.toMatchObject({
      code: 'CURSOR_INVALID',
    });
    await expect(
      archive.list(owner.authentication, { cursor, intention: 'LOVE', limit: 4 }),
    ).rejects.toMatchObject({ code: 'CURSOR_INVALID' });
    const [version, payload] = cursor.split('.');
    await expect(
      archive.list(owner.authentication, {
        cursor: `${String(version)}.${String(payload)}.${'A'.repeat(43)}`,
        limit: 4,
      }),
    ).rejects.toMatchObject({ code: 'CURSOR_INVALID' });
    await expect(
      collection.card(owner.authentication, 'major-00-fool', { cursor, limit: 4 }),
    ).rejects.toMatchObject({ code: 'CURSOR_INVALID' });

    const resumed = await archive.list(owner.authentication, { cursor, limit: 4 });
    expect(resumed.items).toHaveLength(4);
    expect(resumed.nextCursor).toBeNull();
  });

  it('never exposes another account’s readings through list or detail', async () => {
    const owner = await createArchiveFixture();
    const other = await createArchiveFixture();
    await seedDraws(owner, 6, new Date('2026-08-06T10:00:00.000Z'));

    const ownerPage = await archive.list(owner.authentication, { limit: 100 });
    const otherPage = await archive.list(other.authentication, { limit: 100 });
    expect(ownerPage.items).toHaveLength(6);
    expect(otherPage.items).toHaveLength(0);
    expect(otherPage.nextCursor).toBeNull();

    const ownedDraw = ownerPage.items[0];
    if (ownedDraw === undefined) {
      throw new Error('Expected an owned draw.');
    }
    const detail = await archive.get(owner.authentication, ownedDraw.id);
    expect(detail.draw).toEqual(ownedDraw);
    await expect(archive.get(other.authentication, ownedDraw.id)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('stops authorizing immediately for revoked sessions and pending deletion', async () => {
    const revoked = await createArchiveFixture();
    await prisma.sessionFamily.update({
      where: { id: revoked.authentication.sessionFamilyId },
      data: { revokedAt: new Date(), revocationReason: 'LOGOUT' },
    });
    await expect(archive.list(revoked.authentication, { limit: 30 })).rejects.toMatchObject({
      code: 'AUTH_REQUIRED',
    });

    const deleting = await createArchiveFixture();
    await prisma.user.update({
      where: { id: deleting.userId },
      data: { status: 'DELETION_PENDING' },
    });
    await expect(archive.list(deleting.authentication, { limit: 30 })).rejects.toMatchObject({
      code: 'ACCOUNT_DELETION_PENDING',
    });
    await expect(collection.summary(deleting.authentication)).rejects.toMatchObject({
      code: 'ACCOUNT_DELETION_PENDING',
    });
    expect(new FortuneArchiveError('AUTH_REQUIRED').name).toBe('FortuneArchiveError');
  });
});

describe('collection service (integration)', () => {
  it('summarizes all 78 canonical slots with per-orientation discovery truth', async () => {
    const fixture = await createArchiveFixture();
    const templates = await loadActiveTemplates();
    const uprightFool = templates.find(
      (template) => template.cardKey === 'major-00-fool' && template.orientation === 'UPRIGHT',
    );
    const reversedFool = templates.find(
      (template) => template.cardKey === 'major-00-fool' && template.orientation === 'REVERSED',
    );
    const uprightQueen = templates.find(
      (template) => template.cardKey === 'cups-queen' && template.orientation === 'UPRIGHT',
    );
    if (uprightFool === undefined || reversedFool === undefined || uprightQueen === undefined) {
      throw new Error('The seeded development content is missing expected templates.');
    }
    await prisma.fortuneDraw.createMany({
      data: [
        drawRow(fixture, uprightFool, 1, new Date('2026-08-01T10:00:00.000Z')),
        drawRow(fixture, reversedFool, 2, new Date('2026-08-03T10:00:00.000Z')),
        drawRow(fixture, uprightFool, 3, new Date('2026-08-05T10:00:00.000Z')),
        drawRow(fixture, uprightQueen, 4, new Date('2026-08-04T10:00:00.000Z')),
      ],
    });

    const summary = await collection.summary(fixture.authentication);
    expect(summary.totalCount).toBe(78);
    expect(summary.cards).toHaveLength(78);
    expect(summary.unlockedCount).toBe(2);
    expect(summary.cards.map((card) => card.sortOrder)).toEqual(
      Array.from({ length: 78 }, (_, index) => index),
    );

    const fool = summary.cards.find((card) => card.key === 'major-00-fool');
    expect(fool).toMatchObject({
      unlocked: true,
      readingCount: 3,
      firstDiscoveredAt: '2026-08-01T10:00:00.000Z',
      latestReadingAt: '2026-08-05T10:00:00.000Z',
      uprightDiscoveredAt: '2026-08-01T10:00:00.000Z',
      reversedDiscoveredAt: '2026-08-03T10:00:00.000Z',
    });
    const queen = summary.cards.find((card) => card.key === 'cups-queen');
    expect(queen).toMatchObject({
      unlocked: true,
      readingCount: 1,
      uprightDiscoveredAt: '2026-08-04T10:00:00.000Z',
      reversedDiscoveredAt: null,
    });
    const locked = summary.cards.find((card) => card.key === 'wands-03');
    expect(locked).toMatchObject({
      unlocked: false,
      readingCount: 0,
      firstDiscoveredAt: null,
      latestReadingAt: null,
    });
  });

  it('pages per-card readings while keeping the history bounded to that card', async () => {
    const fixture = await createArchiveFixture();
    await seedDraws(fixture, 96, new Date('2026-08-06T10:00:00.000Z'));
    const expectedCount = await prisma.fortuneDraw.count({
      where: { userId: fixture.userId, cardKey: 'wands-03' },
    });

    const seen: string[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await collection.card(fixture.authentication, 'wands-03', {
        limit: 10,
        ...(cursor === undefined ? {} : { cursor }),
      });
      expect(page.card.key).toBe('wands-03');
      expect(page.card.readingCount).toBe(expectedCount);
      expect(page.readings.every((reading) => reading.cardKey === 'wands-03')).toBe(true);
      seen.push(...page.readings.map((reading) => reading.id));
      if (page.nextCursor === null) {
        break;
      }
      cursor = page.nextCursor;
    }
    expect(seen).toHaveLength(expectedCount);
    expect(new Set(seen).size).toBe(expectedCount);
  });

  it('returns a locked canonical card and rejects unknown keys', async () => {
    const fixture = await createArchiveFixture();

    const locked = await collection.card(fixture.authentication, 'swords-ace', { limit: 30 });
    expect(locked.card).toMatchObject({ key: 'swords-ace', unlocked: false, readingCount: 0 });
    expect(locked.readings).toHaveLength(0);
    expect(locked.nextCursor).toBeNull();

    await expect(
      collection.card(fixture.authentication, 'major-99-unknown', { limit: 30 }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(new CollectionError('NOT_FOUND').name).toBe('CollectionError');
  });
});
