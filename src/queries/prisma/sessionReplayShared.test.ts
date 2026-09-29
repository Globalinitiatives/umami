import { beforeEach, expect, test, vi } from 'vitest';
import { ENTITY_TYPE, SHARE_TOKEN_TYPE } from '@/lib/constants';

const upsert = vi.fn();
const findUnique = vi.fn();
const updateMany = vi.fn();
const findMany = vi.fn();
const count = vi.fn();

vi.mock('@/lib/prisma', () => ({
  default: {
    client: {
      sessionReplayShared: {
        upsert: (...args: any[]) => upsert(...args),
        findUnique: (...args: any[]) => findUnique(...args),
        updateMany: (...args: any[]) => updateMany(...args),
        findMany: (...args: any[]) => findMany(...args),
        count: (...args: any[]) => count(...args),
      },
    },
    getSearchParameters: () => ({}),
    pagedQuery: () => ({ data: [], pageInfo: {} }),
  },
}));

vi.mock('@/lib/generate', () => ({
  getRandomChars: (n: number) => 'x'.repeat(n),
}));

vi.mock('@/lib/crypto', () => ({
  secret: () => 'test-secret',
  uuid: () => '00000000-0000-0000-0000-000000000000',
}));

vi.mock('@/lib/jwt', () => ({
  createToken: (payload: any) => `token:${JSON.stringify(payload)}`,
}));

import {
  createReplayShared,
  DEFAULT_SHARE_DURATION,
  getShareExpiry,
  isShareDuration,
  ReplayShareClosedError,
  SHARE_DURATIONS,
} from './sessionReplayShared';

const WEBSITE_ID = 'website-1';
const VISIT_ID = 'visit-1';

const upsertedRecord = (overrides: Record<string, any> = {}) => ({
  id: 'share-1',
  websiteId: WEBSITE_ID,
  visitId: VISIT_ID,
  slug: 'generated-slug',
  note: null,
  showSessionInfo: false,
  expiresAt: getShareExpiry('24h'),
  revokedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  upsert.mockImplementation(async () => upsertedRecord());
  findUnique.mockResolvedValue(undefined);
  updateMany.mockResolvedValue({ count: 1 });
});

test('a share that never existed is created', async () => {
  findUnique.mockResolvedValue(null);

  const share = await createReplayShared({
    websiteId: WEBSITE_ID,
    visitId: VISIT_ID,
    duration: DEFAULT_SHARE_DURATION,
  });

  expect(share.slug).toBe('generated-slug');
  expect(upsert).toHaveBeenCalledOnce();
});

test('the session summary is off unless the owner asks for it', async () => {
  findUnique.mockResolvedValue(null);

  const share = await createReplayShared({
    websiteId: WEBSITE_ID,
    visitId: VISIT_ID,
    duration: '24h',
  });

  expect(share.showSessionInfo).toBe(false);
  expect(upsert.mock.calls[0][0].create.showSessionInfo).toBe(false);
});

test('an opted-in summary is stored and carried in the token', async () => {
  findUnique.mockResolvedValue(null);
  upsert.mockImplementation(async () => upsertedRecord({ showSessionInfo: true }));

  const share = await createReplayShared({
    websiteId: WEBSITE_ID,
    visitId: VISIT_ID,
    duration: '24h',
    showSessionInfo: true,
  });

  expect(share.showSessionInfo).toBe(true);
  expect(share.token).toContain('"showSessionInfo":true');
});

test('the token is a replay credential, never a website-wide one', async () => {
  findUnique.mockResolvedValue(null);

  const { token } = await createReplayShared({
    websiteId: WEBSITE_ID,
    visitId: VISIT_ID,
    duration: '24h',
  });

  const payload = JSON.parse(token.replace(/^token:/, ''));

  expect(payload.type).toBe(SHARE_TOKEN_TYPE);
  expect(payload.shareType).toBe(ENTITY_TYPE.replay);
  expect(payload.entityType).toBe(ENTITY_TYPE.replay);
  expect(payload.shareType).not.toBe(ENTITY_TYPE.website);
  expect(payload.entityType).not.toBe(ENTITY_TYPE.website);
  expect(payload.websiteId).toBe(WEBSITE_ID);
  expect(payload.visitId).toBe(VISIT_ID);
});

/**
 * Re-issuing an expired share would mint a fresh slug for the same recording,
 * so "this link expires" would quietly become "this recording has a new link".
 * The rule is that a closed share stays closed.
 */
test('an expired share cannot be re-issued', async () => {
  findUnique.mockResolvedValue(upsertedRecord({ expiresAt: new Date(Date.now() - 1000) }));

  await expect(
    createReplayShared({ websiteId: WEBSITE_ID, visitId: VISIT_ID, duration: '24h' }),
  ).rejects.toThrow(ReplayShareClosedError);

  expect(upsert).not.toHaveBeenCalled();
});

test('a revoked share cannot be re-issued', async () => {
  findUnique.mockResolvedValue(upsertedRecord({ revokedAt: new Date() }));

  await expect(
    createReplayShared({ websiteId: WEBSITE_ID, visitId: VISIT_ID, duration: '24h' }),
  ).rejects.toThrow(/revoked/);

  expect(upsert).not.toHaveBeenCalled();
});

test('re-issuing never clears a revocation, because it is refused outright', async () => {
  // A previous implementation set revokedAt: null on update, which silently
  // resurrected a revoked link. The row must never be written at all.
  findUnique.mockResolvedValue(upsertedRecord({ revokedAt: new Date() }));

  await expect(
    createReplayShared({ websiteId: WEBSITE_ID, visitId: VISIT_ID, duration: '24h' }),
  ).rejects.toThrow();

  const written = upsert.mock.calls[0]?.[0]?.update;
  expect(written?.revokedAt).toBeUndefined();
});

test('a still-valid share can be re-issued with a new slug', async () => {
  findUnique.mockResolvedValue(upsertedRecord({ expiresAt: new Date(Date.now() + 60_000) }));

  await createReplayShared({ websiteId: WEBSITE_ID, visitId: VISIT_ID, duration: '7d' });

  const update = upsert.mock.calls[0][0].update;

  expect(update.slug).toBe('x'.repeat(16));
  expect(update.revokedAt).toBeUndefined();
});

test('expiry is computed from the chosen duration', () => {
  const now = new Date('2026-09-29T12:00:00.000Z');

  expect(getShareExpiry('1h', now).getTime() - now.getTime()).toBe(60 * 60 * 1000);
  expect(getShareExpiry('24h', now).getTime() - now.getTime()).toBe(SHARE_DURATIONS['24h']);
  expect(getShareExpiry('7d', now).getTime() - now.getTime()).toBe(SHARE_DURATIONS['7d']);
});

test('only the offered durations are accepted', () => {
  expect(isShareDuration('1h')).toBe(true);
  expect(isShareDuration('24h')).toBe(true);
  expect(isShareDuration('7d')).toBe(true);
  expect(isShareDuration('30d')).toBe(false);
  expect(isShareDuration('forever')).toBe(false);
  expect(isShareDuration(undefined)).toBe(false);
  expect(isShareDuration(1)).toBe(false);
});
