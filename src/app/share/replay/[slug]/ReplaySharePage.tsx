'use client';
import { Column, Row, Text } from '@umami/react-zen';
import { useContext } from 'react';
import { ReplayPlayer } from '@/app/(main)/websites/[websiteId]/replays/[replayId]/ReplayPlayer';
import { SessionInfo } from '@/app/(main)/websites/[websiteId]/sessions/SessionInfo';
import { LoadingPanel } from '@/components/common/LoadingPanel';
import { useReplayQuery, useWebsiteSessionQuery } from '@/components/hooks';
import { ReplayShareContext } from './ReplayShareProvider';

/**
 * Public, single-replay playback. Renders the same player as the owner-facing
 * modal; the share note stays internal and is never shown here.
 *
 * The session summary is opt-in per share. When enabled the visitor also sees
 * the session's country, browser, OS, device and timings, but never the visitor
 * identifier: the API strips it server-side, so the summary renders without that
 * column rather than the client hiding it.
 */
export function ReplaySharePage() {
  const share = useContext(ReplayShareContext);
  const { data: replay, isLoading, error } = useReplayQuery(share.websiteId, share.visitId);
  const { data: session } = useWebsiteSessionQuery(
    share.websiteId,
    // Only fetch when the share opted in; the endpoint rejects the request
    // otherwise, so there is no point spending one.
    share.showSessionInfo ? replay?.sessionId : undefined,
  );

  return (
    <Column padding="6" gap="4" width="100%">
      <Row justifyContent="space-between" alignItems="center" gap="3">
        <Text weight="bold">Replay</Text>
      </Row>
      <LoadingPanel
        data={replay}
        isLoading={isLoading}
        error={error}
        loadingIcon="spinner"
        style={{ minHeight: '400px' }}
      >
        {replay && <ReplayPlayer events={replay.events} />}
      </LoadingPanel>
      {share.showSessionInfo && session && <SessionInfo data={session} />}
    </Column>
  );
}
