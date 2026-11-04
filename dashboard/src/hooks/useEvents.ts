import { useCallback, useEffect, useState } from 'react';
import { api, UnauthorizedError } from '../api/client';
import type { EventsPage, StatusCounts } from '../api/types';
import { PAGE_SIZE, useStore } from '../store';

const REFRESH_INTERVAL_MS = 10_000;

interface Loaded {
  events: EventsPage | null;
  counts: StatusCounts | null;
  error: string | null;
  lastUpdated: Date | null;
}

/**
 * Loads the current page of events plus the per-status counts, and reloads them when the
 * filter or page changes, when refresh() is called, and (optionally) every 10 seconds.
 * A response that arrives after the inputs changed is discarded, so a slow request can never
 * overwrite newer data.
 */
export function useEvents() {
  const apiKey = useStore((s) => s.apiKey);
  const statusFilter = useStore((s) => s.statusFilter);
  const page = useStore((s) => s.page);
  const autoRefresh = useStore((s) => s.autoRefresh);
  const signOut = useStore((s) => s.signOut);

  const [data, setData] = useState<Loaded>({ events: null, counts: null, error: null, lastUpdated: null });
  const [loading, setLoading] = useState(false);
  const [version, setVersion] = useState(0);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (!apiKey) return;
    const controller = new AbortController();
    setLoading(true);

    Promise.all([
      api.listEvents(
        apiKey,
        { status: statusFilter === 'all' ? undefined : statusFilter, limit: PAGE_SIZE, offset: page * PAGE_SIZE },
        controller.signal,
      ),
      api.getStats(apiKey, controller.signal),
    ])
      .then(([events, counts]) => {
        setData({ events, counts, error: null, lastUpdated: new Date() });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof UnauthorizedError) {
          signOut(`${err.message} Enter it again.`);
          return;
        }
        setData((previous) => ({ ...previous, error: err instanceof Error ? err.message : 'Something went wrong.' }));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [apiKey, statusFilter, page, version, signOut]);

  useEffect(() => {
    if (!apiKey || !autoRefresh) return;
    const timer = setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [apiKey, autoRefresh, refresh]);

  return { ...data, loading, refresh, version };
}
