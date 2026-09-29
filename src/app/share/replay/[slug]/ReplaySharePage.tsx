'use client';
import { Column, Row, Text } from '@umami/react-zen';
import { useContext } from 'react';
import { ReplayPlayer } from '@/app/(main)/websites/[websiteId]/replays/[replayId]/ReplayPlayer';
import { LoadingPanel } from '@/components/common/LoadingPanel';
import { useReplayQuery } from '@/components/hooks';
import { ReplayShareContext } from './ReplayShareProvider';

/**
 * Public, single-replay playback. Renders the same player as the owner-facing
 * modal; the share note stays internal and is never shown here.
 */
export function ReplaySharePage() {
  const share = useContext(ReplayShareContext);
  const { data: replay, isLoading, error } = useReplayQuery(share.websiteId, share.visitId);

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
    </Column>
  );
}
