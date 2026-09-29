import { json, notFound } from '@/lib/response';
import {
  createReplayShareToken,
  getReplaySharedBySlug,
} from '@/queries/prisma/sessionReplayShared';

/**
 * Exchanges a public replay slug for a short-lived, replay-scoped share token.
 *
 * The token is bound to the single visit it was minted for, so the client can
 * only ever fetch the one recording behind this link.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const record = await getReplaySharedBySlug(slug);

  if (!record) {
    return notFound();
  }

  if (record.revokedAt) {
    return notFound();
  }

  // Expiry is enforced here as well as in the token, so a stale link never
  // yields a usable token in the first place.
  if (record.expiresAt.getTime() <= Date.now()) {
    return notFound();
  }

  const token = createReplayShareToken({
    websiteId: record.websiteId,
    visitId: record.visitId,
    slug: record.slug,
    expiresAt: record.expiresAt,
    showSessionInfo: record.showSessionInfo,
  });

  return json({
    websiteId: record.websiteId,
    visitId: record.visitId,
    showSessionInfo: record.showSessionInfo,
    token,
    expiresAt: record.expiresAt,
  });
}
