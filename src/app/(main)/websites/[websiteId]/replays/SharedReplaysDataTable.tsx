import { DataGrid } from '@/components/common/DataGrid';
import { useSharedReplaysQuery } from '@/components/hooks';
import { SharedReplaysTable } from './SharedReplaysTable';

export function SharedReplaysDataTable({ websiteId }: { websiteId: string }) {
  const queryResult = useSharedReplaysQuery(websiteId);

  return (
    <DataGrid query={queryResult} allowPaging allowSearch>
      {({ data }) => {
        return <SharedReplaysTable websiteId={websiteId} data={data} />;
      }}
    </DataGrid>
  );
}
