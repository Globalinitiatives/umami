import {
  Button,
  DataColumn,
  DataTable,
  type DataTableProps,
  Icon,
  Switch,
  Text,
  Tooltip,
  TooltipTrigger,
  useToast,
} from '@umami/react-zen';
import { Copy, Play, Undo2 } from 'lucide-react';
import { DateDistance } from '@/components/common/DateDistance';
import { useApi, useConfig, useMessages, useNavigation } from '@/components/hooks';
import { useModified } from '@/components/hooks/useModified';

export function SharedReplaysTable({
  websiteId,
  ...props
}: DataTableProps & { websiteId: string }) {
  const { t, labels, messages } = useMessages();
  const { router, updateParams } = useNavigation();
  const { cloudMode } = useConfig();
  const { del, patch, useMutation } = useApi();
  const { touch } = useModified();
  const { toast } = useToast();

  // Revoke targets a path segment, so the mutation is built per row.
  const { mutate, isPending } = useMutation({
    mutationFn: (replayId: string) => del(`/websites/${websiteId}/replays/shared/${replayId}`),
    onSuccess: () => {
      touch('replays');
      toast(t(messages.replayRevoked));
    },
  });

  /**
   * Toggling the summary is a display preference on a share that already
   * exists, so it PATCHes in place. It deliberately does not re-share: rotating
   * the slug would break a link the recipient may already have open.
   */
  const { mutate: setSummary } = useMutation({
    mutationFn: (row: { visitId: string; showSessionInfo: boolean }) =>
      patch(`/websites/${websiteId}/replays/shared/${row.visitId}`, {
        showSessionInfo: !row.showSessionInfo,
      }),
    onSuccess: () => {
      touch('replays');
    },
  });

  const getShareUrl = (slug: string) =>
    `${cloudMode ? process.env.cloudUrl : window?.location.origin}${process.env.basePath || ''}/share/replay/${slug}`;

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
      {/* Toggles the session summary on the already-issued link. Sits between
          Shared and Expires, next to the dates that describe the link's life. */}
      <DataColumn id="showSessionInfo" label={t(labels.summary)} width="120px">
        {(row: any) => (
          <TooltipTrigger delay={0}>
            <Switch
              isSelected={!!row.showSessionInfo}
              isDisabled={isPending}
              onChange={() => setSummary(row)}
            />
            <Tooltip>
              {row.showSessionInfo ? t(messages.replaySummaryOn) : t(messages.replaySummaryOff)}
            </Tooltip>
          </TooltipTrigger>
        )}
      </DataColumn>
      <DataColumn id="expiresAt" label={t(labels.expires)} width="160px">
        {(row: any) => <DateDistance date={new Date(row.expiresAt)} />}
      </DataColumn>
      {/* Copies the existing link. Reads the slug already returned by the
          authenticated owner list — it never mints, rotates or re-exposes a
          token, so copying cannot invalidate a link already sent out. */}
      <DataColumn id="copy" label="" width="80px">
        {(row: any) => (
          <TooltipTrigger delay={0}>
            <Button
              variant="quiet"
              onPress={async () => {
                await navigator.clipboard.writeText(getShareUrl(row.slug));
                toast(t(messages.replayLinkCopiedMessage));
              }}
            >
              <Icon>
                <Copy />
              </Icon>
            </Button>
            <Tooltip>{t(labels.copyLink)}</Tooltip>
          </TooltipTrigger>
        )}
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
