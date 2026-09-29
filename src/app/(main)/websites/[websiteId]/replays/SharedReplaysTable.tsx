import { Button, DataColumn, DataTable, type DataTableProps, Icon, Text } from '@umami/react-zen';
import { Play, Undo2 } from 'lucide-react';
import { DateDistance } from '@/components/common/DateDistance';
import { useApi, useMessages, useNavigation } from '@/components/hooks';
import { useModified } from '@/components/hooks/useModified';

export function SharedReplaysTable({
  websiteId,
  ...props
}: DataTableProps & { websiteId: string }) {
  const { t, labels } = useMessages();
  const { router, updateParams } = useNavigation();
  const { del, useMutation } = useApi();
  const { touch } = useModified();

  // Revoke targets a path segment, so the mutation is built per row.
  const { mutate, isPending } = useMutation({
    mutationFn: (replayId: string) => del(`/websites/${websiteId}/replays/shared/${replayId}`),
    onSuccess: () => touch('replays'),
  });

  return (
    <DataTable {...props}>
      <DataColumn id="play" label="" width="80px">
        {(row: any) => (
          <Button
            variant="quiet"
            onClick={() => router.push(updateParams({ replay: row.visitId }))}
          >
            <Icon>
              <Play />
            </Icon>
          </Button>
        )}
      </DataColumn>
      <DataColumn id="note" label={t(labels.note)}>
        {(row: any) => <Text truncate>{row.note || '—'}</Text>}
      </DataColumn>
      <DataColumn id="visitId" label={t(labels.replayId)} />
      <DataColumn id="createdAt" label={t(labels.shared)} width="160px">
        {(row: any) => <DateDistance date={new Date(row.createdAt)} />}
      </DataColumn>
      <DataColumn id="expiresAt" label={t(labels.expires)} width="160px">
        {(row: any) => <DateDistance date={new Date(row.expiresAt)} />}
      </DataColumn>
      <DataColumn id="revoke" label={t(labels.revoke)} width="120px">
        {(row: any) => (
          <Button variant="quiet" disabled={isPending} onPress={() => mutate(row.visitId)}>
            <Icon>
              <Undo2 />
            </Icon>
          </Button>
        )}
      </DataColumn>
    </DataTable>
  );
}
