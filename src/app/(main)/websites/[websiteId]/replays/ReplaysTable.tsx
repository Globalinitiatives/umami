import { Button, DataColumn, DataTable, type DataTableProps, Icon } from '@umami/react-zen';
import { Play } from 'lucide-react';
import { Avatar } from '@/components/common/Avatar';
import { DateDistance } from '@/components/common/DateDistance';
import Link from '@/components/common/Link';
import { SortableLabel } from '@/components/common/SortableLabel';
import { TypeIcon } from '@/components/common/TypeIcon';
import { useFormat, useMessages, useNavigation } from '@/components/hooks';

function formatDuration(ms: number) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

export function ReplaysTable({ ...props }: DataTableProps) {
  const { t, labels } = useMessages();
  const { formatValue } = useFormat();
  const { router, updateParams } = useNavigation();

  return (
    <DataTable {...props}>
      <DataColumn id="play" label="" width="80px">
        {(row: any) => (
          <Button variant="quiet" onClick={() => router.push(updateParams({ replay: row.id }))}>
            <Icon>
              <Play />
            </Icon>
          </Button>
        )}
      </DataColumn>
      <DataColumn id="id" label={t(labels.session)} width="100px">
        {(row: any) => (
          <Link href={updateParams({ session: row.sessionId })}>
            <Avatar seed={row.sessionId} size={32} />
          </Link>
        )}
      </DataColumn>
      <DataColumn
        id="duration"
        label={
          <SortableLabel label={t(labels.duration)} sortKey="duration" defaultDirection="desc" />
        }
        width="100px"
      >
        {(row: any) => formatDuration(row.duration || 0)}
      </DataColumn>
      <DataColumn
        id="eventCount"
        label={
          <SortableLabel label={t(labels.actions)} sortKey="eventCount" defaultDirection="desc" />
        }
        width="80px"
      />
      <DataColumn
        id="location"
        label={<SortableLabel label={t(labels.location)} sortKey="location" />}
      >
        {(row: any) => (
          <TypeIcon type="country" value={row.country}>
            {row.city ? `${row.city}, ` : ''}
            {formatValue(row.country, 'country')}
          </TypeIcon>
        )}
      </DataColumn>
      <DataColumn
        id="browser"
        label={<SortableLabel label={t(labels.browser)} sortKey="browser" />}
        width="140px"
      >
        {(row: any) => (
          <TypeIcon type="browser" value={row.browser}>
            {formatValue(row.browser, 'browser')}
          </TypeIcon>
        )}
      </DataColumn>
      <DataColumn
        id="os"
        label={<SortableLabel label={t(labels.os)} sortKey="os" />}
        width="140px"
      >
        {(row: any) => (
          <TypeIcon type="os" value={row.os}>
            {formatValue(row.os, 'os')}
          </TypeIcon>
        )}
      </DataColumn>
      <DataColumn
        id="device"
        label={<SortableLabel label={t(labels.device)} sortKey="device" />}
        width="140px"
      >
        {(row: any) => (
          <TypeIcon type="device" value={row.device}>
            {formatValue(row.device, 'device')}
          </TypeIcon>
        )}
      </DataColumn>
      <DataColumn
        id="createdAt"
        label={
          <SortableLabel label={t(labels.recorded)} sortKey="createdAt" defaultDirection="desc" />
        }
        width="160px"
      >
        {(row: any) => <DateDistance date={new Date(row.createdAt)} />}
      </DataColumn>
    </DataTable>
  );
}
