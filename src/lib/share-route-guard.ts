import type { Auth } from '@/lib/types';

/**
 * Why a share token cannot be allowed onto a user-scoped route.
 *
 * `checkAuth` returns `{ user: null, authType: 'share', shareToken }` for a
 * share token — there is no `user` (see `src/lib/auth.ts`). A handler that
 * reads `auth.user.id` therefore threw
 * `TypeError: Cannot read properties of null (reading 'id')` and returned 500.
 *
 * That 500 was doing accidental work. The query layer is reached with
 * `userId: undefined`, and Prisma DROPS undefined keys from a `where` clause,
 * so `getUserWebsites(undefined)` degrades to `where: {}` and returns every
 * website in the instance. Softening the deref to `auth.user?.id` would turn
 * the crash into a full table dump. It has to become a refusal instead.
 *
 * The gate is `authType`, which `checkAuth` derives server-side. The
 * `x-gmanalytics-share-context` header is NOT usable as the gate: it is sent by
 * the client (`useApi.ts`) and is therefore forgeable by any caller.
 */

/** True when `auth` came from a share token rather than a session or API key. */
export function isShareTokenAuth(auth: Auth | null | undefined) {
  if (!auth) {
    return false;
  }

  return auth.authType === 'share' || (!!auth.shareToken && !auth.user);
}
