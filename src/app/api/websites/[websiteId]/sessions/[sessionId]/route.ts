import { isRelationalOnly } from '@/lib/db';
import { parseRequest } from '@/lib/request';
import { badRequest, json, notFound, ok, unauthorized } from '@/lib/response';
import { canDeleteWebsite, canViewSharedReplay, canViewWebsiteSection } from '@/permissions';
import { deleteSession, getReplaySharedBySlug } from '@/queries/prisma';
import {
  getLinkedDistinctIds,
  getLinkedSessionIds,
  getReplayChunks,
  getWebsiteSession,
} from '@/queries/sql';

/**
 * Strips the fields a public replay link must never carry.
 *
 * distinctId is a persistent cross-session identifier: it follows one visitor
 * across visits and sessions, so exposing it to a client outside the team turns
 * a single recording into a tracking handle. It is removed from the response
 * object itself, not merely hidden by the client, so no request shape can put
 * it back.
 *
 * `id` goes with it. It is the session uuid rather than a visitor identifier,
 * but the summary renders nothing that needs it, and the replay link already
 * implies which recording it is.
 *
 * The stitched-session walk is skipped too, because resolving linked sessions
 * is itself built around distinctId.
 */
export function toPublicSession(data: Record<string, any>) {
  const { distinctId, distinctIds, stitchedSessionCount, websiteId, id, ...rest } = data;

  return rest;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ websiteId: string; sessionId: string }> },
) {
  const { auth, error } = await parseRequest(request);

  if (error) {
    return error();
  }

  const { websiteId, sessionId } = await params;
  const canDelete = isRelationalOnly() && (await canDeleteWebsite(auth, websiteId));

  const isOwner = await canViewWebsiteSection(auth, websiteId, [
    'sessions',
    'events',
    'realtime',
    'revenue',
  ]);

  if (!isOwner) {
    // A public replay link may fetch its own session's summary, but only when
    // the share opted in, and only for the exact visit the token is bound to.
    const { shareToken } = auth || {};

    if (shareToken?.showSessionInfo !== true) {
      return unauthorized();
    }

    if (!(await canViewSharedReplay(auth, websiteId, shareToken?.visitId ?? ''))) {
      return unauthorized();
    }

    // The share row is authoritative, not the token. The owner can turn the
    // summary off for a link that is already out, and that has to take effect
    // immediately: a token minted while the summary was on would otherwise
    // keep serving the summary until it expired.
    const share = await getReplaySharedBySlug(shareToken.slug ?? '');

    if (!share?.showSessionInfo || share.websiteId !== websiteId) {
      return unauthorized();
    }

    // The share is bound to one visit, and the replay is the only thing that
    // knows which session that visit belongs to. Verifying against the
    // requested sessionId is what stops a caller naming an arbitrary session in
    // the URL: the visit is the only credential, and the session must match it.
    //
    // This runs before the session is read, so a mismatched session is never
    // fetched at all rather than fetched and then discarded.
    const chunks = await getReplayChunks(websiteId, shareToken.visitId);
    const replaySessionId = chunks.length > 0 ? chunks[0].sessionId : null;

    if (!replaySessionId || replaySessionId !== sessionId) {
      return notFound();
    }

    const data = await getWebsiteSession(websiteId, sessionId);

    if (!data) {
      return notFound();
    }

    return json(toPublicSession(data));
  }

  const data = await getWebsiteSession(websiteId, sessionId);

  if (!data) {
    return notFound();
  }

  let sessionIds = [sessionId];
  const linkedDistinctIds = await getLinkedDistinctIds(websiteId, sessionId);
  const distinctIds = linkedDistinctIds.length
    ? linkedDistinctIds
    : data.distinctId
      ? [data.distinctId]
      : [];
  const distinctId = distinctIds.length === 1 ? distinctIds[0] : undefined;

  // A collided legacy session cannot be safely attributed to one identity.
  data.distinctId = distinctId;

  if (distinctId) {
    const links = await getLinkedSessionIds(websiteId, distinctId);
    const linkedIds = links.map(link => link.sessionId);

    sessionIds = Array.from(new Set([sessionId, ...linkedIds]));
  }

  const stitchedSessionCount = sessionIds.length;

  return json({
    ...data,
    canDelete,
    distinctIds,
    stitchedSessionCount,
  });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ websiteId: string; sessionId: string }> },
) {
  const { auth, error } = await parseRequest(request);

  if (error) {
    return error();
  }

  if (!isRelationalOnly()) {
    return badRequest({ message: 'Session deletion is only available with relational storage.' });
  }

  const { websiteId, sessionId } = await params;

  if (!(await canDeleteWebsite(auth, websiteId))) {
    return unauthorized();
  }

  const deletedSession = await deleteSession(websiteId, sessionId);

  if (!deletedSession) {
    return notFound();
  }

  return ok();
}
