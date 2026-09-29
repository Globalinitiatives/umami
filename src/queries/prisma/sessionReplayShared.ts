import { ENTITY_TYPE, SHARE_TOKEN_TYPE } from '@/lib/constants';
import { secret, uuid } from '@/lib/crypto';
import { getRandomChars } from '@/lib/generate';
import { createToken } from '@/lib/jwt';
import prisma from '@/lib/prisma';
import type { PageResult, QueryFilters } from '@/lib/types';

export const SHARE_DURATIONS = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
} as const;

export type ShareDuration = keyof typeof SHARE_DURATIONS;

export const DEFAULT_SHARE_DURATION: ShareDuration = '24h';

export function isShareDuration(value: unknown): value is ShareDuration {
  return typeof value === 'string' && value in SHARE_DURATIONS;
}

export function getShareExpiry(duration: ShareDuration, from = new Date()) {
  return new Date(from.getTime() + SHARE_DURATIONS[duration]);
}

/**
 * Mints a token bound to exactly one replay. Because the token carries a single
 * visitId and the row's slug, a share link can never be widened to a sibling
 * recording, and re-sharing rotates the slug so the old token stops working.
 */
export function createReplayShareToken(args: {
  websiteId: string;
  visitId: string;
  slug: string;
  expiresAt: Date;
}) {
  return createToken(
    {
      type: SHARE_TOKEN_TYPE,
      entityType: ENTITY_TYPE.website,
      websiteId: args.websiteId,
      visitId: args.visitId,
      slug: args.slug,
    },
    secret(),
    { expiresIn: Math.max(1, Math.floor((args.expiresAt.getTime() - Date.now()) / 1000)) },
  );
}

export async function createReplayShared(args: {
  websiteId: string;
  visitId: string;
  note?: string;
  duration: ShareDuration;
}) {
  const expiresAt = getShareExpiry(args.duration);

  const record = await prisma.client.sessionReplayShared.upsert({
    where: {
      websiteId_visitId: { websiteId: args.websiteId, visitId: args.visitId },
    },
    create: {
      id: uuid(),
      websiteId: args.websiteId,
      visitId: args.visitId,
      slug: getRandomChars(16),
      note: args.note ?? null,
      expiresAt,
    },
    update: {
      slug: getRandomChars(16),
      note: args.note ?? null,
      expiresAt,
      revokedAt: null,
    },
  });

  const token = createReplayShareToken({
    websiteId: record.websiteId,
    visitId: record.visitId,
    slug: record.slug,
    expiresAt: record.expiresAt,
  });

  return { ...record, token, url: `/share/replay/${record.slug}` };
}

export async function getReplayShared(websiteId: string, visitId: string) {
  return prisma.client.sessionReplayShared.findUnique({
    where: { websiteId_visitId: { websiteId, visitId } },
  });
}

export async function getReplaySharedBySlug(slug: string) {
  return prisma.client.sessionReplayShared.findUnique({
    where: { slug },
    select: {
      id: true,
      websiteId: true,
      visitId: true,
      slug: true,
      expiresAt: true,
      revokedAt: true,
    },
  });
}

export async function revokeReplayShared(websiteId: string, visitId: string) {
  return prisma.client.sessionReplayShared.updateMany({
    where: { websiteId, visitId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function getSharedReplays(
  websiteId: string,
  filters: QueryFilters,
): Promise<PageResult<any[]>> {
  const { search } = filters;
  const { getSearchParameters, pagedQuery } = prisma;

  const where = {
    websiteId,
    ...getSearchParameters(search, [{ note: 'contains' }]),
  };

  return pagedQuery(
    'sessionReplayShared',
    {
      where,
      orderBy: { createdAt: 'desc' },
    },
    filters,
  );
}
