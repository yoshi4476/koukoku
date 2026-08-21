'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { MeDto } from '@adgrid/shared';
import { apiGet, apiPost, ApiAuthError, ApiError, toApiError } from '@/lib/api';
import { ErrorCard } from '@/components/ui';

interface AuthContextValue {
  me: MeDto;
  loggingOut: boolean;
  logout: () => void;
}

const Ctx = createContext<AuthContextValue | null>(null);

/**
 * シェル内画面の認証ゲート。
 * マウント時に GET /auth/me を確認し、未ログイン (401) は /login へ誘導する。
 * 確認が完了するまで子 (ClientProvider / Shell) は描画しない。
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<MeDto | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [tick, setTick] = useState(0);

  const retry = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let alive = true;
    setError(null);
    apiGet<MeDto>('/auth/me')
      .then((data) => {
        if (alive) setMe(data);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        if (e instanceof ApiAuthError) {
          router.replace('/login');
          return;
        }
        setError(toApiError(e));
      });
    return () => {
      alive = false;
    };
  }, [tick, router]);

  const logout = useCallback(() => {
    setLoggingOut(true);
    apiPost<{ ok: boolean }>('/auth/logout', {})
      .then(() => router.replace('/login'))
      .catch(() => {
        // 失敗してもクッキーが残るだけなので、ログイン画面へ移動して再ログインしてもらう
        router.replace('/login');
      });
  }, [router]);

  if (error) {
    return (
      <div className="auth-gate">
        <span className="auth-gate-brand">
          AD<span className="bx">GRID</span>
        </span>
        <div style={{ width: '100%', maxWidth: 480, padding: '0 16px' }}>
          <ErrorCard error={error} onRetry={retry} />
        </div>
      </div>
    );
  }

  if (!me) {
    return (
      <div className="auth-gate" aria-label="読み込み中">
        <span className="auth-gate-brand">
          AD<span className="bx">GRID</span>
        </span>
        <span className="auth-gate-text">セッションを確認しています…</span>
      </div>
    );
  }

  return <Ctx.Provider value={{ me, loggingOut, logout }}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('AuthProvider の内側で使用してください');
  return v;
}
