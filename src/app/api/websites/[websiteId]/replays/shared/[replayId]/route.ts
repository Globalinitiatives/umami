import { z } from 'zod';
import { parseRequest } from '@/lib/request';
import { json, notFound, unauthorized } from '@/lib/response';
import { canUpdateWebsite, canViewAuthenticatedWebsite } from '@/permissions';
import {
  getReplayShared,
  revokeReplayShared,
  updateReplaySharedOptions,
} from '@/queries/prisma/sessionReplayShared';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ websiteId: string; replayId: string }> },
) {
  const { auth, error } = await parseRequest(request);

  if (error) {
    return error();
  }

  const { websiteId, replayId } = await params;

  if (!(await canViewAuthenticatedWebsite(auth, websiteId))) {
    return unauthorized();
  }

  const record = await getReplayShared(websiteId, replayId);

  // Deliberately omits the slug: the owner-facing list links by visit id, and
  // the public link is only handed out at creation time.
  return json({
    isShared: !!record && !record.revokedAt && record.expiresAt.getTime() > Date.now(),
    note: record?.note ?? null,
    showSessionInfo: record?.showSessionInfo ?? false,
    expiresAt: record?.expiresAt ?? null,
  });
}

/**
 * Toggles whether the public page renders the session summary. Kept separate
 * from re-sharing: changing this must not rotate the slug, because it is a
 * display preference, not a new grant of access — rotating would break a link
 * somebody may have already opened.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ websiteId: string; replayId: string }> },
) {
  const schema = z.object({
    showSessionInfo: z.boolean(),
  });

  const { auth, body, error } = await parseRequest(request, schema);

  if (error) {
    return error();
  }

  const { websiteId, replayId } = await params;

  if (!(await canUpdateWebsite(auth, websiteId))) {
    return unauthorized();
  }

  const { showSessionInfo } = body;

  const { count } = await updateReplaySharedOptions(websiteId, replayId, { showSessionInfo });

  if (!count) {
    return notFound();
  }

  return json({ showSessionInfo });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ websiteId: string; replayId: string }> },
) {
  const { auth, error } = await parseRequest(request);

  if (error) {
    return error();
  }

  const { websiteId, replayId } = await params;

  if (!(await canUpdateWebsite(auth, websiteId))) {
    return unauthorized();
  }

  await revokeReplayShared(websiteId, replayId);

  return json({ ok: true });
}
