"use client";

import { useCallback, useState } from "react";
import { api, buildQuery, errorMessage } from "@/lib/api-client";
import { useResource } from "@/lib/useResource";

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** Cursor-paginated list with filters. Changing `params` restarts from the first page. */
export function useCursorList<T>(path: string, params: Record<string, string | number | undefined>) {
  const key = `${path}${buildQuery(params)}`;
  const first = useResource<Page<T>>(key, (signal) => api<Page<T>>(key, { signal }));
  const [more, setMore] = useState<{ key: string; items: T[]; cursor: string | null } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);

  // Extra pages only count while they belong to the current first page (same key, same first cursor).
  const extra = more && more.key === key ? more : null;
  const items = first.data ? [...first.data.items, ...(extra?.items ?? [])] : null;
  const cursor = extra ? extra.cursor : (first.data?.nextCursor ?? null);

  const loadMore = useCallback(async () => {
    if (!cursor) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await api<Page<T>>(`${path}${buildQuery({ ...params, cursor })}`);
      setMore((prev) => ({ key, items: [...(prev && prev.key === key ? prev.items : []), ...page.items], cursor: page.nextCursor }));
    } catch (err) {
      setMoreError(errorMessage(err));
    } finally {
      setLoadingMore(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `params` is captured via `key`
  }, [cursor, key, path]);

  const reload = useCallback(() => {
    setMore(null);
    first.reload();
  }, [first]);

  return { items, error: first.error ?? moreError, hasMore: !!cursor, loadMore, loadingMore, reload };
}
