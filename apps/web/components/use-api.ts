'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet, ApiError, toApiError } from '@/lib/api';

interface UseApiState<T> {
  data: T | null;
  loading: boolean;
  error: ApiError | null;
  /** 旧データを消してスケルトン再表示で取り直す (条件変更・エラー再試行向け) */
  retry: () => void;
  /** 旧データを保持したまま背景で取り直す (保存後の静かな更新向け。画面が点滅しない) */
  refresh: () => void;
}

/** path が null の間は取得しない (依存する選択が未確定のケース) */
export function useApi<T>(path: string | null): UseApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const [error, setError] = useState<ApiError | null>(null);
  const [tick, setTick] = useState(0);
  // 直近の再取得が「静かな更新(refresh)」かどうか。true の間はデータ/スケルトンを消さない
  const softRef = useRef(false);

  const retry = useCallback(() => {
    softRef.current = false;
    setTick((t) => t + 1);
  }, []);
  const refresh = useCallback(() => {
    softRef.current = true;
    setTick((t) => t + 1);
  }, []);

  useEffect(() => {
    if (path === null) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }
    let alive = true;
    // 静かな更新でなければ、旧データとスケルトンの二重表示を避けてリセットする
    if (!softRef.current) {
      setData(null);
      setLoading(true);
    }
    softRef.current = false;
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

  return { data, loading, error, retry, refresh };
}
