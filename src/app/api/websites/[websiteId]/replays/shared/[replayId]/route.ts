import { parseRequest } from '@/lib/request';
import { json, unauthorized } from '@/lib/response';
import { canUpdateWebsite, canViewAuthenticatedWebsite } from '@/permissions';
import { getReplayShared, revokeReplayShared } from '@/queries/prisma/sessionReplayShared';

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
    expiresAt: record?.expiresAt ?? null,
  });
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
