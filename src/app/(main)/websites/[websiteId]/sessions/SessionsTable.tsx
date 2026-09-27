import { DataColumn, DataTable, type DataTableProps } from '@umami/react-zen';
import { Avatar } from '@/components/common/Avatar';
import { DateDistance } from '@/components/common/DateDistance';
import Link from '@/components/common/Link';
import { SortableLabel } from '@/components/common/SortableLabel';
import { TypeIcon } from '@/components/common/TypeIcon';
import { useFormat, useMessages } from '@/components/hooks';
import { formatShortTime } from '@/lib/format';

export function SessionsTable({
  websiteId,
  getSessionHref,
  ...props
}: DataTableProps & { websiteId: string; getSessionHref?: (row: any) => string }) {
  const { t, labels } = useMessages();
  const { formatValue } = useFormat();

  return (
    <DataTable {...props}>
      <DataColumn id="id" label={t(labels.session)} width="100px">
        {(row: any) => (
          <Link
            href={
              getSessionHref ? getSessionHref(row) : `/websites/${websiteId}/sessions/${row.id}`
            }
            scroll={getSessionHref ? false : undefined}
          >
            <Avatar seed={row.id} size={32} />
          </Link>
        )}
      </DataColumn>
      <DataColumn
        id="visits"
        label={<SortableLabel label={t(labels.visits)} sortKey="visits" />}
        width="80px"
      />
      <DataColumn
        id="views"
        label={<SortableLabel label={t(labels.views)} sortKey="views" />}
        width="80px"
      />
      <DataColumn
        id="events"
        label={<SortableLabel label={t(labels.events)} sortKey="events" />}
        width="80px"
      />
      <DataColumn
        id="duration"
        label={
          <SortableLabel
            label={t(labels.duration)}
            sortKey="duration"
            defaultDirection="desc"
          />
        }
        width="100px"
      >
        {(row: any) => formatShortTime(Number(row.duration) || 0, ['m', 's'], ' ')}
      </DataColumn>
      <DataColumn
        id="location"
        label={<SortableLabel label={t(labels.location)} sortKey="location" />}
        width="200px"
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
      <DataColumn id="os" label={<SortableLabel label={t(labels.os)} sortKey="os" />} width="140px">
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
        id="lastAt"
        label={
          <SortableLabel label={t(labels.lastSeen)} sortKey="lastAt" defaultDirection="desc" />
        }
        width="140px"
      >
        {(row: any) => <DateDistance date={new Date(row.createdAt)} />}
      </DataColumn>
    </DataTable>
  );
}
