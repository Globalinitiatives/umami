import { expect, test, vi } from 'vitest';
import { ENTITY_TYPE } from '@/lib/constants';

vi.mock('@/queries/prisma', () => ({
  getReplaySharedBySlug: vi.fn(),
  getTeamUser: vi.fn(),
  getWebsite: vi.fn(),
  getPixel: vi.fn(),
  getLink: vi.fn(),
  getBoard: vi.fn(),
}));

import { canViewLink } from './link';
import { canViewPixel } from './pixel';
import { canViewSharedWebsite, canViewSharedWebsiteFilters, canViewWebsiteSection } from './share';
import { canViewBatchWebsites, canViewWebsite } from './website';

const WEBSITE_ID = '0c5ff9dd-8a8c-48b3-9ba2-d66eedcdb9fe';
const VISIT_ID = '1126b0a9-6186-5f34-8acb-63bcb1149bc1';
const SLUG = 'abc123XYZ_slug01';

/**
 * A public replay link is a credential for ONE recording. Every share guard that
 * matches a token by websiteId/pixelId/linkId is a potential escape hatch,
 * because the replay token legitimately carries a websiteId in order to scope
 * the recording. These tests pin that it is rejected by all of them.
 *
 * The share.ts suite mocks ./website to isolate the share guards, so these
 * assertions live here to exercise the real entity guards.
 */
const replayToken = (overrides: Record<string, any> = {}) =>
  ({
    shareToken: {
      shareType: ENTITY_TYPE.replay,
      entityType: ENTITY_TYPE.replay,
      websiteId: WEBSITE_ID,
      visitId: VISIT_ID,
      slug: SLUG,
      ...overrides,
    },
  }) as any;

/** A token minted before the fix: entityType ENTITY_TYPE.website, no shareType. */
const legacyReplayToken = () =>
  replayToken({ shareType: undefined, entityType: ENTITY_TYPE.website });

test('a replay token is not website-wide share access', async () => {
  const auth = replayToken();

  await expect(canViewWebsiteSection(auth, WEBSITE_ID, 'sessions')).resolves.toBe(false);
  await expect(canViewWebsiteSection(auth, WEBSITE_ID, ['events', 'revenue'])).resolves.toBe(false);
  await expect(canViewWebsiteSection(auth, WEBSITE_ID, 'not-a-real-section' as any)).resolves.toBe(
    false,
  );
  await expect(canViewSharedWebsite(auth, WEBSITE_ID)).resolves.toBe(false);
  await expect(canViewSharedWebsiteFilters(auth, WEBSITE_ID)).resolves.toBe(false);
});

test('a replay token is not accepted by the entity guards', async () => {
  const auth = replayToken();

  await expect(canViewWebsite(auth, WEBSITE_ID)).resolves.toBe(false);
  await expect(canViewPixel(auth, WEBSITE_ID)).resolves.toBe(false);
  await expect(canViewLink(auth, WEBSITE_ID)).resolves.toBe(false);
  await expect(canViewBatchWebsites(auth, [WEBSITE_ID])).resolves.toEqual([]);
});

test('a pre-fix replay token is rejected the same way', async () => {
  const auth = legacyReplayToken();

  await expect(canViewWebsiteSection(auth, WEBSITE_ID, 'sessions')).resolves.toBe(false);
  await expect(canViewSharedWebsite(auth, WEBSITE_ID)).resolves.toBe(false);
  await expect(canViewSharedWebsiteFilters(auth, WEBSITE_ID)).resolves.toBe(false);
  await expect(canViewWebsite(auth, WEBSITE_ID)).resolves.toBe(false);
  await expect(canViewPixel(auth, WEBSITE_ID)).resolves.toBe(false);
  await expect(canViewLink(auth, WEBSITE_ID)).resolves.toBe(false);
  await expect(canViewBatchWebsites(auth, [WEBSITE_ID])).resolves.toEqual([]);
});

test('an ordinary website share is unaffected by the replay guard', async () => {
  const auth = {
    shareToken: {
      shareType: ENTITY_TYPE.website,
      websiteId: WEBSITE_ID,
      parameters: {},
    },
  } as any;

  await expect(canViewWebsiteSection(auth, WEBSITE_ID, 'sessions')).resolves.toBe(true);
  await expect(canViewWebsite(auth, WEBSITE_ID)).resolves.toBe(true);
  await expect(canViewSharedWebsite(auth, WEBSITE_ID)).resolves.toBe(true);
  await expect(canViewBatchWebsites(auth, [WEBSITE_ID])).resolves.toEqual([WEBSITE_ID]);
});

test('an ordinary pixel and link share is unaffected by the replay guard', async () => {
  const pixel = { shareToken: { shareType: ENTITY_TYPE.pixel, pixelId: WEBSITE_ID } } as any;
  const link = { shareToken: { shareType: ENTITY_TYPE.link, linkId: WEBSITE_ID } } as any;

  await expect(canViewPixel(pixel, WEBSITE_ID)).resolves.toBe(true);
  await expect(canViewLink(link, WEBSITE_ID)).resolves.toBe(true);
});
