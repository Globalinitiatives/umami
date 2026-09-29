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
  showSessionInfo?: boolean;
}) {
  return createToken(
    {
      type: SHARE_TOKEN_TYPE,
      // Both keys are set deliberately: `shareType` is the key real share
      // tokens use, `entityType` keeps older tokens identifiable. Neither is
      // ENTITY_TYPE.website — a replay link must not be able to satisfy the
      // website-wide share guards.
      shareType: ENTITY_TYPE.replay,
      entityType: ENTITY_TYPE.replay,
      websiteId: args.websiteId,
      visitId: args.visitId,
      slug: args.slug,
      // Whether the public page may render the session summary. Carried in the
      // token so the session endpoint can decide without trusting the client.
      showSessionInfo: args.showSessionInfo === true,
    },
    secret(),
    { expiresIn: Math.max(1, Math.floor((args.expiresAt.getTime() - Date.now()) / 1000)) },
  );
}

/**
 * Thrown when a share exists but can no longer be re-issued.
 *
 * A replay that was already shared and then expired (or was revoked) stays that
 * way. Re-issuing would mint a fresh slug for the same recording, which turns
 * "this link expired" into "this recording has a new permanent link" — the
 * expiry the recipient was told about would stop meaning anything. The owner can
 * still see the recording in Replays, but a closed share is closed.
 */
export class ReplayShareClosedError extends Error {
  readonly code: 'replay-share-closed';

  constructor(reason: 'expired' | 'revoked') {
    super(
      reason === 'revoked'
        ? 'Replay link was revoked and cannot be re-issued'
        : 'Replay link expired and cannot be re-issued',
    );
    this.name = 'ReplayShareClosedError';
    this.code = 'replay-share-closed';
  }
}

export async function createReplayShared(args: {
  websiteId: string;
  visitId: string;
  note?: string;
  duration: ShareDuration;
  showSessionInfo?: boolean;
}) {
  const existing = await getReplayShared(args.websiteId, args.visitId);

  // Only a share that is still open may be re-issued. A missing row is a fresh
  // share, which is always allowed.
  if (existing) {
    if (existing.revokedAt) {
      throw new ReplayShareClosedError('revoked');
    }

    if (existing.expiresAt.getTime() <= Date.now()) {
      throw new ReplayShareClosedError('expired');
    }
  }

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
      // Defaults to off: the session summary is optional and is the piece most
      // worth keeping off a link that leaves the team.
      showSessionInfo: args.showSessionInfo ?? false,
      expiresAt,
    },
    update: {
      slug: getRandomChars(16),
      note: args.note ?? null,
      showSessionInfo: args.showSessionInfo ?? false,
      expiresAt,
    },
  });

  const token = createReplayShareToken({
    websiteId: record.websiteId,
    visitId: record.visitId,
    slug: record.slug,
    expiresAt: record.expiresAt,
    showSessionInfo: record.showSessionInfo,
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
      showSessionInfo: true,
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

/**
 * Updates display options on an existing share. Does not touch the slug or
 * expiry, so a link already sent out keeps working and stays unrevoked.
 */
export async function updateReplaySharedOptions(
  websiteId: string,
  visitId: string,
  data: { showSessionInfo?: boolean },
) {
  return prisma.client.sessionReplayShared.updateMany({
    where: { websiteId, visitId, revokedAt: null },
    data,
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
