import type { Auth } from '@/lib/types';
import { getReplaySharedBySlug } from '@/queries/prisma';
import { canViewWebsite } from './website';

export type ShareSection =
  | 'overview'
  | 'events'
  | 'sessions'
  | 'realtime'
  | 'performance'
  | 'compare'
  | 'breakdown'
  | 'goals'
  | 'funnels'
  | 'journeys'
  | 'retention'
  | 'utm'
  | 'revenue'
  | 'attribution';

const SHARE_SECTIONS: ShareSection[] = [
  'overview',
  'events',
  'sessions',
  'realtime',
  'performance',
  'compare',
  'breakdown',
  'goals',
  'funnels',
  'journeys',
  'retention',
  'utm',
  'revenue',
  'attribution',
];

type ShareSectionInput = ShareSection | ShareSection[];

function shareTokenIncludesWebsite(auth: Auth | null | undefined, websiteId: string) {
  const { shareToken } = auth || {};

  return (
    shareToken?.websiteId === websiteId ||
    shareToken?.pixelId === websiteId ||
    shareToken?.linkId === websiteId ||
    shareToken?.websiteIds?.includes(websiteId) ||
    shareToken?.pixelIds?.includes(websiteId) ||
    shareToken?.linkIds?.includes(websiteId)
  );
}

export async function canViewWebsiteSection(
  auth: Auth | null | undefined,
  websiteId: string,
  section: ShareSectionInput,
) {
  if (auth?.user) {
    return canViewWebsite(auth, websiteId);
  }

  const { shareToken } = auth || {};

  if (!shareToken || !shareTokenIncludesWebsite(auth, websiteId)) {
    return false;
  }

  const sections = Array.isArray(section) ? section : [section];
  const hasSectionParameters = SHARE_SECTIONS.some(
    key => typeof shareToken.parameters?.[key] === 'boolean',
  );

  if (!hasSectionParameters) {
    return true;
  }

  return sections.some(key => shareToken.parameters?.[key] === true);
}

export async function canViewSharedWebsite(auth: Auth | null | undefined, websiteId: string) {
  if (auth?.user) {
    return canViewWebsite(auth, websiteId);
  }

  return shareTokenIncludesWebsite(auth, websiteId);
}

export async function canViewSharedWebsiteFilters(
  auth: Auth | null | undefined,
  websiteId: string,
) {
  if (auth?.user) {
    return canViewWebsite(auth, websiteId);
  }

  const { shareToken } = auth || {};

  return (
    shareTokenIncludesWebsite(auth, websiteId) && shareToken?.parameters?.allowFilter !== false
  );
}

export async function canViewAuthenticatedWebsite(
  auth: Auth | null | undefined,
  websiteId: string,
) {
  if (!auth?.user) {
    return false;
  }

  return canViewWebsite(auth, websiteId);
}

/**
 * Guards access to a single replay.
 *
 * A share token grants access to exactly one recording: it carries the slug and
 * visitId it was minted for, and the row behind that slug must still be live. A
 * token for replay A can never open replay B. Expiry and revocation are read
 * from the row rather than trusted from the token, so a revoked link dies
 * immediately instead of living out the token's remaining lifetime.
 */
export async function canViewSharedReplay(
  auth: Auth | null | undefined,
  websiteId: string,
  visitId: string,
) {
  if (auth?.user) {
    return canViewWebsite(auth, websiteId);
  }

  const { shareToken } = auth || {};

  if (!shareToken) {
    return false;
  }

  // A replay share token must be bound to this exact website AND this exact
  // visit. Website-wide share tokens carry neither and are rejected here.
  if (!shareTokenIncludesWebsite(auth, websiteId)) {
    return false;
  }

  if (shareToken.visitId !== visitId) {
    return false;
  }

  const slug = shareToken.slug;

  if (typeof slug !== 'string' || !slug) {
    return false;
  }

  // The slug is the record's identity, so re-sharing rotates it and retires the
  // previous token automatically.
  const record = await getReplaySharedBySlug(slug);

  if (!record || record.websiteId !== websiteId || record.visitId !== visitId) {
    return false;
  }

  if (record.revokedAt) {
    return false;
  }

  if (record.expiresAt.getTime() <= Date.now()) {
    return false;
  }

  return true;
}
