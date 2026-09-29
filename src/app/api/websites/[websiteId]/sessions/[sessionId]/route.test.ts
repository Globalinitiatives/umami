import { beforeEach, expect, test, vi } from 'vitest';
import { ENTITY_TYPE } from '@/lib/constants';
import { isRelationalOnly } from '@/lib/db';
import { parseRequest } from '@/lib/request';
import { canDeleteWebsite, canViewSharedReplay, canViewWebsiteSection } from '@/permissions';
import { deleteSession, getReplaySharedBySlug } from '@/queries/prisma';
import {
  getLinkedDistinctIds,
  getLinkedSessionIds,
  getReplayChunks,
  getWebsiteSession,
} from '@/queries/sql';
import { DELETE, GET, toPublicSession } from './route';

vi.mock('@/lib/db', () => ({
  isRelationalOnly: vi.fn(),
}));

vi.mock('@/lib/request', () => ({
  parseRequest: vi.fn(),
}));

vi.mock('@/permissions', () => ({
  canDeleteWebsite: vi.fn(),
  canViewSharedReplay: vi.fn(),
  canViewWebsiteSection: vi.fn(),
}));

vi.mock('@/queries/prisma', () => ({
  deleteSession: vi.fn(),
  getReplaySharedBySlug: vi.fn(),
}));

vi.mock('@/queries/sql', () => ({
  getLinkedDistinctIds: vi.fn(),
  getLinkedSessionIds: vi.fn(),
  getReplayChunks: vi.fn(),
  getWebsiteSession: vi.fn(),
}));

const isRelationalOnlyMock = vi.mocked(isRelationalOnly);
const parseRequestMock = vi.mocked(parseRequest);
const canDeleteWebsiteMock = vi.mocked(canDeleteWebsite);
const canViewSharedReplayMock = vi.mocked(canViewSharedReplay);
const canViewWebsiteSectionMock = vi.mocked(canViewWebsiteSection);
const deleteSessionMock = vi.mocked(deleteSession);
const getReplaySharedBySlugMock = vi.mocked(getReplaySharedBySlug);
const getLinkedDistinctIdsMock = vi.mocked(getLinkedDistinctIds);
const getLinkedSessionIdsMock = vi.mocked(getLinkedSessionIds);
const getReplayChunksMock = vi.mocked(getReplayChunks);
const getWebsiteSessionMock = vi.mocked(getWebsiteSession);

beforeEach(() => {
  isRelationalOnlyMock.mockReset();
  parseRequestMock.mockReset();
  canDeleteWebsiteMock.mockReset();
  canViewSharedReplayMock.mockReset();
  canViewWebsiteSectionMock.mockReset();
  deleteSessionMock.mockReset();
  getReplaySharedBySlugMock.mockReset();
  getLinkedDistinctIdsMock.mockReset();
  getLinkedSessionIdsMock.mockReset();
  getReplayChunksMock.mockReset();
  getWebsiteSessionMock.mockReset();
});

test('GET returns not found when the session does not exist', async () => {
  parseRequestMock.mockResolvedValue({ auth: {}, error: undefined });
  canViewWebsiteSectionMock.mockResolvedValue(true);
  isRelationalOnlyMock.mockReturnValue(true);
  canDeleteWebsiteMock.mockResolvedValue(false);
  getWebsiteSessionMock.mockResolvedValue(undefined);

  const response = await GET(
    new Request('http://localhost/api/websites/website-1/sessions/missing-session'),
    {
      params: Promise.resolve({ websiteId: 'website-1', sessionId: 'missing-session' }),
    },
  );

  expect(response.status).toBe(404);
  await expect(response.json()).resolves.toMatchObject({
    error: { code: 'not-found', status: 404 },
  });
  expect(getLinkedDistinctIdsMock).not.toHaveBeenCalled();
  expect(getLinkedSessionIdsMock).not.toHaveBeenCalled();
});

test('GET includes canDelete when relational storage and delete permission are available', async () => {
  parseRequestMock.mockResolvedValue({ auth: {}, error: undefined });
  canViewWebsiteSectionMock.mockResolvedValue(true);
  isRelationalOnlyMock.mockReturnValue(true);
  canDeleteWebsiteMock.mockResolvedValue(true);
  getWebsiteSessionMock.mockResolvedValue({
    id: 'session-1',
    distinctId: 'distinct-1',
  });
  getLinkedDistinctIdsMock.mockResolvedValue(['distinct-1']);
  getLinkedSessionIdsMock.mockResolvedValue([
    { sessionId: 'session-2', createdAt: '2026-07-24T00:00:00.000Z' },
  ]);

  const response = await GET(
    new Request('http://localhost/api/websites/website-1/sessions/session-1'),
    {
      params: Promise.resolve({ websiteId: 'website-1', sessionId: 'session-1' }),
    },
  );

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toMatchObject({
    id: 'session-1',
    canDelete: true,
    distinctIds: ['distinct-1'],
    stitchedSessionCount: 2,
  });
});

test('GET does not stitch a session with multiple linked identities', async () => {
  parseRequestMock.mockResolvedValue({ auth: {}, error: undefined });
  canViewWebsiteSectionMock.mockResolvedValue(true);
  isRelationalOnlyMock.mockReturnValue(true);
  canDeleteWebsiteMock.mockResolvedValue(false);
  getWebsiteSessionMock.mockResolvedValue({ id: 'session-1', distinctId: 'distinct-2' });
  getLinkedDistinctIdsMock.mockResolvedValue(['distinct-1', 'distinct-2']);

  const response = await GET(
    new Request('http://localhost/api/websites/website-1/sessions/session-1'),
    {
      params: Promise.resolve({ websiteId: 'website-1', sessionId: 'session-1' }),
    },
  );

  const body = await response.json();

  expect(body).toMatchObject({
    distinctIds: ['distinct-1', 'distinct-2'],
    stitchedSessionCount: 1,
  });
  expect(body).not.toHaveProperty('distinctId');
  expect(getLinkedSessionIdsMock).not.toHaveBeenCalled();
});

test('DELETE rejects session deletion for non-relational storage', async () => {
  parseRequestMock.mockResolvedValue({ auth: {}, error: undefined });
  isRelationalOnlyMock.mockReturnValue(false);

  const response = await DELETE(
    new Request('http://localhost/api/websites/website-1/sessions/session-1', { method: 'DELETE' }),
    {
      params: Promise.resolve({ websiteId: 'website-1', sessionId: 'session-1' }),
    },
  );

  expect(response.status).toBe(400);
  await expect(response.json()).resolves.toMatchObject({
    error: { code: 'bad-request' },
  });
  expect(canDeleteWebsiteMock).not.toHaveBeenCalled();
  expect(deleteSessionMock).not.toHaveBeenCalled();
});

test('DELETE returns unauthorized when the user cannot delete the website', async () => {
  parseRequestMock.mockResolvedValue({ auth: {}, error: undefined });
  isRelationalOnlyMock.mockReturnValue(true);
  canDeleteWebsiteMock.mockResolvedValue(false);

  const response = await DELETE(
    new Request('http://localhost/api/websites/website-1/sessions/session-1', { method: 'DELETE' }),
    {
      params: Promise.resolve({ websiteId: 'website-1', sessionId: 'session-1' }),
    },
  );

  expect(response.status).toBe(401);
  expect(deleteSessionMock).not.toHaveBeenCalled();
});

test('DELETE returns not found when the session does not exist', async () => {
  parseRequestMock.mockResolvedValue({ auth: {}, error: undefined });
  isRelationalOnlyMock.mockReturnValue(true);
  canDeleteWebsiteMock.mockResolvedValue(true);
  deleteSessionMock.mockResolvedValue(null);

  const response = await DELETE(
    new Request('http://localhost/api/websites/website-1/sessions/missing-session', {
      method: 'DELETE',
    }),
    {
      params: Promise.resolve({ websiteId: 'website-1', sessionId: 'missing-session' }),
    },
  );

  expect(response.status).toBe(404);
  await expect(response.json()).resolves.toMatchObject({
    error: { code: 'not-found', status: 404 },
  });
});

test('DELETE removes the session when the request is valid', async () => {
  parseRequestMock.mockResolvedValue({ auth: {}, error: undefined });
  isRelationalOnlyMock.mockReturnValue(true);
  canDeleteWebsiteMock.mockResolvedValue(true);
  deleteSessionMock.mockResolvedValue({ id: 'session-1' });

  const response = await DELETE(
    new Request('http://localhost/api/websites/website-1/sessions/session-1', { method: 'DELETE' }),
    {
      params: Promise.resolve({ websiteId: 'website-1', sessionId: 'session-1' }),
    },
  );

  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({ ok: true });
  expect(deleteSessionMock).toHaveBeenCalledWith('website-1', 'session-1');
});

/**
 * The public replay summary is the only website data an unauthenticated visitor
 * can read, so these pin the redaction rather than the rendering. A visitor
 * identifier reaching a public link would be a privacy regression, not a UI
 * bug: distinctId follows one person across visits and sessions, so publishing
 * it turns a single recording into a durable tracking handle.
 */
const PUBLIC_SESSION_ROW = {
  id: 'session-1',
  distinctId: 'visitor-abc-123',
  websiteId: 'website-1',
  browser: 'Chrome',
  os: 'macOS',
  device: 'Desktop',
  language: 'en-GB',
  country: 'TN',
  region: 'Tunis',
  city: 'Tunis',
  firstAt: '2026-09-29T00:00:00.000Z',
  lastAt: '2026-09-29T00:30:00.000Z',
  visits: 1,
  views: 12,
  events: 3,
  totaltime: 1800,
};

const replayTokenAuth = (showSessionInfo: boolean) =>
  ({
    shareToken: {
      type: 'umami-share',
      shareType: ENTITY_TYPE.replay,
      entityType: ENTITY_TYPE.replay,
      websiteId: 'website-1',
      visitId: 'visit-1',
      slug: 'public-slug-1',
      showSessionInfo,
    },
  }) as any;

const getPublic = (sessionId = 'session-1') =>
  GET(new Request(`http://localhost/api/websites/website-1/sessions/${sessionId}`), {
    params: Promise.resolve({ websiteId: 'website-1', sessionId }),
  });

function mockPublicShare(showSessionInfo = true) {
  parseRequestMock.mockResolvedValue({ auth: replayTokenAuth(showSessionInfo), error: undefined });
  isRelationalOnlyMock.mockReturnValue(true);
  canDeleteWebsiteMock.mockResolvedValue(false);
  // A replay token is never a website section reader: that is the point of the
  // separate credential class.
  canViewWebsiteSectionMock.mockResolvedValue(false);
  canViewSharedReplayMock.mockResolvedValue(true);
  getWebsiteSessionMock.mockResolvedValue(PUBLIC_SESSION_ROW);
  getReplayChunksMock.mockResolvedValue([{ sessionId: 'session-1' } as any]);
  getReplaySharedBySlugMock.mockResolvedValue({
    websiteId: 'website-1',
    visitId: 'visit-1',
    slug: 'public-slug-1',
    showSessionInfo,
  } as any);
}

test('a public replay link cannot read the visitor identifier', async () => {
  mockPublicShare();

  const response = await getPublic();
  const body = await response.json();

  expect(response.status).toBe(200);

  // The key must be absent, not merely null: present-but-null would let a later
  // refactor start rendering it again without any test failing here.
  expect(body).not.toHaveProperty('distinctId');
  expect(Object.keys(body)).not.toContain('distinctId');
  expect(JSON.stringify(body)).not.toContain('visitor-abc-123');

  // The visitor identifier must not be smuggled back in a stitched-session
  // list either, and the owner-only stitching walk must not run for a visitor.
  expect(body).not.toHaveProperty('distinctIds');
  expect(body).not.toHaveProperty('stitchedSessionCount');
  expect(getLinkedDistinctIdsMock).not.toHaveBeenCalled();
  expect(getLinkedSessionIdsMock).not.toHaveBeenCalled();
});

test('a public replay link still gets the fields the summary renders', async () => {
  mockPublicShare();

  const body = await (await getPublic()).json();

  expect(body).toMatchObject({
    country: 'TN',
    region: 'Tunis',
    city: 'Tunis',
    browser: 'Chrome',
    os: 'macOS',
    device: 'Desktop',
    language: 'en-GB',
    firstAt: PUBLIC_SESSION_ROW.firstAt,
    lastAt: PUBLIC_SESSION_ROW.lastAt,
    visits: 1,
    views: 12,
    events: 3,
  });
});

test('toPublicSession drops every visitor-identifying field it is given', () => {
  const out = toPublicSession({
    ...PUBLIC_SESSION_ROW,
    distinctIds: ['visitor-abc-123', 'visitor-abc-456'],
    stitchedSessionCount: 3,
  });

  expect(out).not.toHaveProperty('distinctId');
  expect(out).not.toHaveProperty('distinctIds');
  expect(out).not.toHaveProperty('stitchedSessionCount');
  expect(out).not.toHaveProperty('websiteId');
  expect(JSON.stringify(out)).not.toContain('visitor-abc');
});

test('a share with the summary off is refused before any session is read', async () => {
  // showSessionInfo comes from the signed token, not the request, so a public
  // client cannot turn the summary on for a link that has it off.
  mockPublicShare(false);

  const response = await getPublic();

  expect(response.status).toBe(401);
  expect(getWebsiteSessionMock).not.toHaveBeenCalled();
});

test('a replay link cannot read a session other than the one its replay shows', async () => {
  mockPublicShare();

  // The visit is the only credential, so naming a different session in the URL
  // must not return that session's summary. It must not even be read.
  const response = await getPublic('some-other-session');

  expect(response.status).toBe(404);
  expect(getReplayChunksMock).toHaveBeenCalledWith('website-1', 'visit-1');
  expect(getWebsiteSessionMock).not.toHaveBeenCalled();
});

test('a replay link gets nothing when the share permission denies it', async () => {
  mockPublicShare();
  canViewSharedReplayMock.mockResolvedValue(false);

  const response = await getPublic();

  expect(response.status).toBe(401);
  expect(getWebsiteSessionMock).not.toHaveBeenCalled();
});

test('the share row overrides a token that was minted while the summary was on', async () => {
  mockPublicShare();
  // The owner turned the summary off after the link went out. The token still
  // says showSessionInfo: true, but the row is authoritative, so the summary
  // must stop being served immediately rather than at token expiry.
  getReplaySharedBySlugMock.mockResolvedValue({ showSessionInfo: false } as any);

  const response = await getPublic();

  expect(response.status).toBe(401);
  expect(getWebsiteSessionMock).not.toHaveBeenCalled();
});

test('a summary read is refused if the share row has gone', async () => {
  mockPublicShare();
  getReplaySharedBySlugMock.mockResolvedValue(null);

  const response = await getPublic();

  expect(response.status).toBe(401);
  expect(getWebsiteSessionMock).not.toHaveBeenCalled();
});

test('a share row for a different website is refused', async () => {
  mockPublicShare();
  getReplaySharedBySlugMock.mockResolvedValue({
    showSessionInfo: true,
    websiteId: 'website-2',
  } as any);

  const response = await getPublic();

  expect(response.status).toBe(401);
  expect(getWebsiteSessionMock).not.toHaveBeenCalled();
});
