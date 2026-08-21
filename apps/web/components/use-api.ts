'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiGet, ApiError, toApiError } from '@/lib/api';

interface UseApiState<T> {
  data: T | null;
  loading: boolean;
  error: ApiError | null;
  retry: () => void;
}

/** path が null の間は取得しない (依存する選択が未確定のケース) */
export function useApi<T>(path: string | null): UseApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const [error, setError] = useState<ApiError | null>(null);
  const [tick, setTick] = useState(0);

  const retry = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (path === null) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }
    let alive = true;
    // 条件変更時に旧データとスケルトンが二重表示されないよう毎回リセットする
    setData(null);
    setLoading(true);
    setError(null);
    apiGet<T>(path)
      .then((d) => {
        if (!alive) return;
        setData(d);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setError(toApiError(e));
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [path, tick]);

  return { data, loading, error, retry };
}
