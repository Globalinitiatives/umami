import { beforeEach, describe, expect, test, vi } from 'vitest';
import { z } from 'zod';
import { checkAuth } from '@/lib/auth';
import { parseRequest } from '@/lib/request';
import { getUserWebsites } from '@/queries/prisma/website';

vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgresql://user:***@localhost:5432/umami?schema=public';
  delete process.env.DATABASE_REPLICA_URL;
});

vi.mock('@/lib/auth', () => ({
  checkAuth: vi.fn(),
}));

vi.mock('@/lib/load', () => ({
  fetchAccount: vi.fn(),
  fetchWebsite: vi.fn().mockResolvedValue({ id: 'website-1' }),
}));

vi.mock('@/queries/prisma', () => ({
  getWebsiteSegment: vi.fn(),
}));

const checkAuthMock = vi.mocked(checkAuth);
const getUserWebsitesMock = vi.mocked(getUserWebsites);

vi.mock('@/queries/prisma/website', () => ({
  getUserWebsites: vi.fn(),
  getAllUserWebsitesIncludingTeamAccess: vi.fn(),
}));

const WEBSITE_ID = '11111111-1111-1111-1111-111111111111';
const VISIT_ID = 'visit-1';

/** A replay share token as `checkAuth` builds it: a shareToken and NO user. */
function replayShareAuth() {
  return {
    token: 'tok',
    authType: 'share' as const,
    user: null,
    shareToken: {
      shareType: 5,
      entityType: 5,
      websiteId: WEBSITE_ID,
      visitId: VISIT_ID,
      slug: 'abc123',
    },
  } as any;
}

/** A website share token: also a credential, also has no user. */
function websiteShareAuth() {
  return {
    token: 'tok',
    authType: 'share' as const,
    user: null,
    shareToken: { shareType: 1, websiteId: WEBSITE_ID },
  } as any;
}

function sessionAuth() {
  return {
    token: 'tok',
    authType: 'session' as const,
    user: { id: 'user-1', username: 'u', role: 'admin', isAdmin: true },
  } as any;
}

function req(url = 'http://localhost/api/websites') {
  return new Request(url);
}

beforeEach(() => {
  checkAuthMock.mockReset();
  getUserWebsitesMock.mockReset();
  getUserWebsitesMock.mockResolvedValue({ data: [], page: 1, pageSize: 10, total: 0 } as any);
});

describe('parseRequest: share tokens on user-scoped routes', () => {
  test('refuses a replay share token with 401 by default', async () => {
    checkAuthMock.mockResolvedValue(replayShareAuth());

    const { error, auth } = await parseRequest(req());

    expect(error).toBeTypeOf('function');
    const res = error!() as Response;
    expect(res.status).toBe(401);
    expect(auth).toBeNull();
  });

  test('refuses a website share token with 401 by default', async () => {
    checkAuthMock.mockResolvedValue(websiteShareAuth());

    const { error } = await parseRequest(req());

    expect((error!() as Response).status).toBe(401);
  });

  /**
   * The reason the refusal must happen in parseRequest rather than being left
   * to the handler: `checkAuth` returns no `user` for a share token, so
   * `auth.user.id` throws (500). Softening it to `auth.user?.id` passes
   * `undefined` into the query layer, and Prisma DROPS undefined keys from a
   * `where` clause — `getUserWebsites(undefined)` becomes `where: {}` and
   * returns every website in the instance.
   *
   * This test models the handler body directly, so it fails if the boundary is
   * ever weakened into a soft deref. It asserts the query is not called with a
   * missing user id — not merely that the response was 401, which a soft deref
   * would also produce.
   */
  test('a handler that reads auth.user.id can never be reached by a share token', async () => {
    checkAuthMock.mockResolvedValue(replayShareAuth());

    const { auth, error } = await parseRequest(req());

    // Whatever the handler does next, it must not query with an undefined user.
    if (!error) {
      getUserWebsitesMock(auth?.user?.id);
    }

    expect(getUserWebsitesMock).not.toHaveBeenCalled();
    for (const call of getUserWebsitesMock.mock.calls) {
      expect(call[0]).toBeTypeOf('string');
      expect(call[0]).toBe('user-1');
    }
  });

  test('a real user is still passed through verbatim', async () => {
    getUserWebsitesMock.mockClear();
    checkAuthMock.mockResolvedValue(sessionAuth());

    const ok = await parseRequest(req());
    expect(ok.error).toBeUndefined();
    expect(ok.auth.user.id).toBe('user-1');
  });

  test('allows a share token when the handler opts in', async () => {
    checkAuthMock.mockResolvedValue(replayShareAuth());

    const { auth, error } = await parseRequest(req(), null, { allowShareToken: true });

    expect(error).toBeUndefined();
    expect(auth.shareToken.visitId).toBe(VISIT_ID);
  });

  test('still requires SOME credential: a share opt-in does not admit anonymous callers', async () => {
    checkAuthMock.mockResolvedValue(null);

    const { error } = await parseRequest(req(), null, { allowShareToken: true });

    expect((error!() as Response).status).toBe(401);
  });

  test('skipAuth bypasses the share check entirely (tracker routes)', async () => {
    checkAuthMock.mockResolvedValue(null);

    const { auth, error } = await parseRequest(req(), null, { skipAuth: true });

    expect(error).toBeUndefined();
    expect(auth).toBeNull();
  });

  test('a schema error still wins over the share check', async () => {
    checkAuthMock.mockResolvedValue(replayShareAuth());

    // A real Zod schema, so the 400 path is exercised as it runs in production.
    const schema = z.object({ required: z.string() });
    const { error } = await parseRequest(req('http://localhost/api/x?other=1'), schema, {
      allowShareToken: true,
    });

    expect((error!() as Response).status).toBe(400);
  });
});

describe('isShareTokenAuth classification', () => {
  test('a share token with a legacy authType but no user is still a share token', async () => {
    checkAuthMock.mockResolvedValue({
      token: 'tok',
      user: null,
      shareToken: { shareType: 5, websiteId: WEBSITE_ID, visitId: VISIT_ID, slug: 'abc' },
    } as any);

    const { error } = await parseRequest(req());

    expect((error!() as Response).status).toBe(401);
  });

  test('a session that also carries a shareToken is not treated as a share token', async () => {
    checkAuthMock.mockResolvedValue({
      token: 'tok',
      authType: 'session' as const,
      user: { id: 'user-1', username: 'u', role: 'admin', isAdmin: true },
      shareToken: { shareType: 1, websiteId: WEBSITE_ID },
    } as any);

    const { auth, error } = await parseRequest(req());

    expect(error).toBeUndefined();
    expect(auth.user.id).toBe('user-1');
  });
});
