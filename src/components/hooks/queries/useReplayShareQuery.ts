import { useEffect } from 'react';
import { setShareData, useApp } from '@/store/app';
import { useApi } from '../useApi';

/**
 * Resolves a public replay slug into a replay-scoped share token and publishes it
 * to the API layer so share headers are attached to subsequent requests.
 */
export function useReplayShareQuery(slug: string) {
  const { get, useQuery } = useApi();
  const shareId = useApp(state => state.share?.shareId);
  const shareToken = useApp(state => state.shareToken?.token);
  const query = useQuery({
    queryKey: ['share-replay', slug],
    queryFn: async () => get(`/share/replay/${slug}`),
  });

  useEffect(() => {
    if (query.data?.token && (shareId !== `replay:${slug}` || shareToken !== query.data.token)) {
      setShareData({ shareId: `replay:${slug}`, slug }, { token: query.data.token });
    }
  }, [query.data, shareId, shareToken, slug]);

  return { share: query.data, ...query };
}
