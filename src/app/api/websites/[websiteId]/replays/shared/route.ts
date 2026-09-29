import { z } from 'zod';
import { parseRequest } from '@/lib/request';
import { json, unauthorized } from '@/lib/response';
import { pagingParams, searchParams } from '@/lib/schema';
import { canViewAuthenticatedWebsite } from '@/permissions';
import {
  createReplayShared,
  DEFAULT_SHARE_DURATION,
  getSharedReplays,
  isShareDuration,
} from '@/queries/prisma/sessionReplayShared';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  const schema = z.object({
    ...pagingParams,
    ...searchParams,
  });

  const { auth, query, error } = await parseRequest(request, schema);

  if (error) {
    return error();
  }

  const { websiteId } = await params;

  if (!(await canViewAuthenticatedWebsite(auth, websiteId))) {
    return unauthorized();
  }

  const data = await getSharedReplays(websiteId, query);

  return json(data);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ websiteId: string }> },
) {
  const schema = z.object({
    visitId: z.string().uuid(),
    note: z.string().max(500).optional(),
    duration: z.string().optional(),
  });

  const { auth, body, error } = await parseRequest(request, schema);

  if (error) {
    return error();
  }

  const { websiteId } = await params;

  // Creating a share is a write on the website, so it requires the stricter
  // owner-authenticated check rather than the replay-view permission.
  if (!(await canViewAuthenticatedWebsite(auth, websiteId))) {
    return unauthorized();
  }

  const { visitId, note, duration } = body;

  const share = await createReplayShared({
    websiteId,
    visitId,
    note,
    duration: isShareDuration(duration) ? duration : DEFAULT_SHARE_DURATION,
  });

  return json(share);
}
