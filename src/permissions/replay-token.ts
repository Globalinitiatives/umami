import { ENTITY_TYPE } from '@/lib/constants';
import type { Auth } from '@/lib/types';

/**
 * A replay share token is scoped to exactly one recording and must never be
 * accepted by any website, pixel, link, or board share guard — those protect
 * whole-entity analytics, and a public replay link is not an entity credential.
 *
 * Every guard that matches a share token by websiteId/pixelId/linkId must call
 * this first, because a replay token legitimately carries a websiteId (it needs
 * one to scope the recording) and would otherwise pass them exactly like a
 * website share.
 *
 * Replay tokens are recognised by their own entity type and, for tokens minted
 * before `shareType` was introduced, structurally by carrying both a visitId
 * and a slug — no other share kind has those.
 *
 * This lives in its own module rather than in share.ts because share.ts imports
 * website.ts; importing it back from the entity guards would create a cycle.
 */
export function isReplayShareToken(auth: Auth | null | undefined) {
  const { shareToken } = auth || {};

  return (
    shareToken?.shareType === ENTITY_TYPE.replay ||
    shareToken?.entityType === ENTITY_TYPE.replay ||
    (typeof shareToken?.visitId === 'string' && !!shareToken?.slug)
  );
}
