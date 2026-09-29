'use client';
import { Loading } from '@umami/react-zen';
import { createContext, type ReactNode, useEffect } from 'react';
import { useReplayShareQuery } from '@/components/hooks';
import { setShareData, useApp } from '@/store/app';

export interface ReplayShareData {
  websiteId: string;
  visitId: string;
  token: string;
  expiresAt: string;
  /** Whether this share opted into showing the session summary on the public page. */
  showSessionInfo: boolean;
}

export const ReplayShareContext = createContext<ReplayShareData>(null);

const selector = (state: { shareToken: { token?: string } | null }) => state.shareToken;

/**
 * Gates the public replay page on a live, unrevoked share slug. The token is
 * scoped to a single visit, so everything rendered below it is limited to that
 * one recording.
 */
export function ReplayShareProvider({ slug, children }: { slug: string; children: ReactNode }) {
  const { share, isLoading, isFetching, error } = useReplayShareQuery(slug);
  const shareToken = useApp(selector);

  const isReady = !!share?.token && shareToken?.token === share.token;

  useEffect(() => {
    return () => {
      setShareData(null, null);
    };
  }, [slug]);

  if (isLoading || (isFetching && !share) || (share && !isReady)) {
    return <Loading placement="absolute" />;
  }

  if (error || !share || !isReady) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <p>This replay link is no longer available.</p>
        <p style={{ opacity: 0.7, fontSize: '0.875rem' }}>
          It may have expired or been revoked. Ask for a new link.
        </p>
      </div>
    );
  }

  return (
    <ReplayShareContext.Provider value={share as ReplayShareData}>
      {children}
    </ReplayShareContext.Provider>
  );
}
