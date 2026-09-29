import { expect, test, vi } from 'vitest';
import { ENTITY_TYPE } from '@/lib/constants';
import { getReplaySharedBySlug } from '@/queries/prisma';
import {
  canViewSharedReplay,
  canViewSharedWebsite,
  canViewSharedWebsiteFilters,
  canViewWebsiteSection,
} from './share';
import { canViewWebsite } from './website';

vi.mock('./website', () => ({
  canViewWebsite: vi.fn(),
}));

vi.mock('@/queries/prisma', () => ({
  getReplaySharedBySlug: vi.fn(),
}));

test('canViewWebsiteSection allows board shares for included websites', async () => {
  await expect(
    canViewWebsiteSection(
      {
        shareToken: {
          shareType: ENTITY_TYPE.board,
          websiteIds: ['website-1'],
          parameters: {},
        },
      },
      'website-1',
      'goals',
    ),
  ).resolves.toBe(true);
});

test('canViewWebsiteSection respects section flags on website shares', async () => {
  await expect(
    canViewWebsiteSection(
      {
        shareToken: {
          shareType: ENTITY_TYPE.website,
          websiteId: 'website-1',
          parameters: {
            overview: true,
            goals: false,
          },
        },
      },
      'website-1',
      'goals',
    ),
  ).resolves.toBe(false);
});

test('canViewWebsiteSection allows any requested enabled section', async () => {
  await expect(
    canViewWebsiteSection(
      {
        shareToken: {
          shareType: ENTITY_TYPE.website,
          websiteId: 'website-1',
          parameters: {
            overview: true,
            compare: false,
          },
        },
      },
      'website-1',
      ['overview', 'compare'],
    ),
  ).resolves.toBe(true);
});

test('canViewSharedWebsite allows board shares for included websites', async () => {
  await expect(
    canViewSharedWebsite(
      {
        shareToken: {
          shareType: ENTITY_TYPE.board,
          websiteIds: ['website-1'],
          parameters: {},
        },
      },
      'website-1',
    ),
  ).resolves.toBe(true);
});

test('canViewSharedWebsiteFilters requires allowFilter for share tokens', async () => {
  await expect(
    canViewSharedWebsiteFilters(
      {
        shareToken: {
          shareType: ENTITY_TYPE.website,
          websiteId: 'website-1',
          parameters: {
            allowFilter: false,
          },
        },
      },
      'website-1',
    ),
  ).resolves.toBe(false);

  await expect(
    canViewSharedWebsiteFilters(
      {
        shareToken: {
          shareType: ENTITY_TYPE.website,
          websiteId: 'website-1',
          parameters: {
            allowFilter: true,
          },
        },
      },
      'website-1',
    ),
  ).resolves.toBe(true);
});

test('canViewWebsiteSection allows pixel shares for the shared entity id', async () => {
  await expect(
    canViewWebsiteSection(
      {
        shareToken: {
          shareType: ENTITY_TYPE.pixel,
          pixelId: 'pixel-1',
          parameters: {
            overview: true,
          },
        },
      },
      'pixel-1',
      'overview',
    ),
  ).resolves.toBe(true);
});

test('canViewWebsiteSection allows link shares for the shared entity id', async () => {
  await expect(
    canViewWebsiteSection(
      {
        shareToken: {
          shareType: ENTITY_TYPE.link,
          linkId: 'link-1',
          parameters: {
            overview: true,
          },
        },
      },
      'link-1',
      'overview',
    ),
  ).resolves.toBe(true);
});

/**
 * canViewSharedReplay is the security boundary for public replay links: a token
 * must open exactly one recording, and only while the share row is live.
 */
const WEBSITE_ID = '0c5ff9dd-8a8c-48b3-9ba2-d66eedcdb9fe';
const VISIT_ID = '1126b0a9-6186-5f34-8acb-63bcb1149bc1';
const OTHER_VISIT_ID = '2226b0a9-6186-5f34-8acb-63bcb1149999';
const OTHER_WEBSITE_ID = 'aaaaaaaa-0000-4000-8000-000000000000';
const SLUG = 'abc123XYZ_slug01';

function mockShareRecord(overrides: Record<string, any> = {}) {
  (getReplaySharedBySlug as any).mockResolvedValue({
    id: 'e1f2a3b4-0000-4000-8000-000000000001',
    websiteId: WEBSITE_ID,
    visitId: VISIT_ID,
    slug: SLUG,
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
    ...overrides,
  });
}

function shareAuth(token: Record<string, any> = {}) {
  return { shareToken: { websiteId: WEBSITE_ID, visitId: VISIT_ID, slug: SLUG, ...token } } as any;
}

function resetMocks() {
  vi.clearAllMocks();
  (canViewWebsite as any).mockResolvedValue(true);
}

test('allows a logged-in owner with website access', async () => {
  resetMocks();
  const auth = { user: { id: 'u1', role: 'user' } } as any;

  await expect(canViewSharedReplay(auth, WEBSITE_ID, VISIT_ID)).resolves.toBe(true);
  expect(getReplaySharedBySlug).not.toHaveBeenCalled();
});

test('allows a valid share token for the matching visit', async () => {
  resetMocks();
  mockShareRecord();

  await expect(canViewSharedReplay(shareAuth(), WEBSITE_ID, VISIT_ID)).resolves.toBe(true);
});

test('rejects a token presented for a different visit', async () => {
  resetMocks();
  mockShareRecord();

  await expect(canViewSharedReplay(shareAuth(), WEBSITE_ID, OTHER_VISIT_ID)).resolves.toBe(false);
});

test('rejects a token for a different website', async () => {
  resetMocks();
  mockShareRecord();

  await expect(canViewSharedReplay(shareAuth(), OTHER_WEBSITE_ID, VISIT_ID)).resolves.toBe(false);
});

test('rejects when no token and no user are present', async () => {
  resetMocks();
  await expect(canViewSharedReplay(null, WEBSITE_ID, VISIT_ID)).resolves.toBe(false);
  await expect(canViewSharedReplay({} as any, WEBSITE_ID, VISIT_ID)).resolves.toBe(false);
});

test('rejects a website-wide share token that carries no visitId', async () => {
  resetMocks();
  mockShareRecord();

  await expect(
    canViewSharedReplay(shareAuth({ visitId: undefined }), WEBSITE_ID, VISIT_ID),
  ).resolves.toBe(false);
});

test('rejects an expired record even while the JWT is still valid', async () => {
  resetMocks();
  mockShareRecord({ expiresAt: new Date(Date.now() - 1000) });

  await expect(canViewSharedReplay(shareAuth(), WEBSITE_ID, VISIT_ID)).resolves.toBe(false);
});

test('rejects a record whose expiry is exactly now', async () => {
  resetMocks();
  mockShareRecord({ expiresAt: new Date(Date.now()) });

  await expect(canViewSharedReplay(shareAuth(), WEBSITE_ID, VISIT_ID)).resolves.toBe(false);
});

test('rejects a revoked record immediately, without waiting out the token', async () => {
  resetMocks();
  mockShareRecord({ revokedAt: new Date(), expiresAt: new Date(Date.now() + 23 * 60 * 60 * 1000) });

  await expect(canViewSharedReplay(shareAuth(), WEBSITE_ID, VISIT_ID)).resolves.toBe(false);
});

test('rejects when the share record is missing', async () => {
  resetMocks();
  (getReplaySharedBySlug as any).mockResolvedValue(null);

  await expect(canViewSharedReplay(shareAuth(), WEBSITE_ID, VISIT_ID)).resolves.toBe(false);
});

test('rejects when the record points at a different visit than the token', async () => {
  resetMocks();
  mockShareRecord({ visitId: OTHER_VISIT_ID });

  await expect(canViewSharedReplay(shareAuth(), WEBSITE_ID, VISIT_ID)).resolves.toBe(false);
});

test('rejects when the record points at a different website', async () => {
  resetMocks();
  mockShareRecord({ websiteId: OTHER_WEBSITE_ID });

  await expect(canViewSharedReplay(shareAuth(), WEBSITE_ID, VISIT_ID)).resolves.toBe(false);
});
