'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export interface ResourceState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * Fetch a TigerEx API route and track loading/error state.
 *
 * The exchange never renders invented market, balance or position data, so
 * callers should show `loading`, `error` or an explicit empty state rather
 * than a placeholder value when `data` is null.
 *
 * @param path API route path, e.g. `/api/futures/contracts`. Pass null to skip.
 */
export function useApiResource<T>(path: string | null): ResourceState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(path !== null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (path === null) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('tigerex_access_token');
      if (token) headers.Authorization = `Bearer ${token}`;
    }

    fetch(path, { signal: controller.signal, headers })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          const message =
            (body && typeof body === 'object' && 'error' in body && String(body.error)) ||
            `Request failed with status ${response.status}`;
          throw new Error(message);
        }
        return body as T;
      })
      .then((body) => {
        if (!mounted.current) return;
        setData(body);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!mounted.current || controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Request failed');
        setData(null);
        setLoading(false);
      });

    return () => controller.abort();
  }, [path, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return { data, loading, error, reload };
}

/**
 * Fetch several endpoints and merge their array payloads into one list.
 *
 * Use this for views that present a unified history across deposits,
 * withdrawals and trades: each source is a real endpoint, and a failure in one
 * source is surfaced rather than hidden.
 */
export function useMergedResource<T>(paths: string[]): ResourceState<T[]> {
  const [data, setData] = useState<T[] | null>(null);
  const [loading, setLoading] = useState(paths.length > 0);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const key = paths.join('|');
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (paths.length === 0) {
      setData([]);
      setLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('tigerex_access_token');
      if (token) headers.Authorization = `Bearer ${token}`;
    }

    Promise.all(
      paths.map(async (path) => {
        const response = await fetch(path, { signal: controller.signal, headers });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          const message =
            (body && typeof body === 'object' && 'error' in body && String(body.error)) ||
            `${path} failed with status ${response.status}`;
          throw new Error(message);
        }
        return toArray<T>(body);
      })
    )
      .then((lists) => {
        if (!mounted.current) return;
        setData(lists.flat());
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (!mounted.current || controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : 'Request failed');
        setData(null);
        setLoading(false);
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  return { data, loading, error, reload };
}

/**
 * Pull the array payload out of a TigerEx API response, which may be a bare
 * array or an envelope such as `{ success, data: [...] }`.
 */
export function toArray<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    for (const key of ['data', 'items', 'results', 'list']) {
      if (Array.isArray(record[key])) return record[key] as T[];
    }
  }
  return [];
}
