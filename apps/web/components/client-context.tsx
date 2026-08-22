'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { ClientDto } from '@adgrid/shared';
import { apiGet, ApiError, toApiError } from '@/lib/api';
import { useAuth } from '@/components/auth-context';

interface ClientContextValue {
  clients: ClientDto[];
  loading: boolean;
  error: ApiError | null;
  /** '' = すべてのクライアント */
  selectedClientId: string;
  setSelectedClientId: (id: string) => void;
  reload: () => void;
}

const Ctx = createContext<ClientContextValue | null>(null);

export function ClientProvider({ children }: { children: ReactNode }) {
  const { me } = useAuth();
  const scope = me.clientScopeId; // 提供先アクセスは常にこのクライアントに固定
  const [clients, setClients] = useState<ClientDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [selectedClientId, setSelectedClientId] = useState(scope ?? '');
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  // 提供先アクセスではクライアント切替を無効化 (常に自分のクライアント)
  const setSelected = useCallback((id: string) => setSelectedClientId(scope ?? id), [scope]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    apiGet<ClientDto[]>('/clients')
      .then((data) => {
        if (!alive) return;
        setClients(data);
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
  }, [tick]);

  return (
    <Ctx.Provider value={{ clients, loading, error, selectedClientId: scope ?? selectedClientId, setSelectedClientId: setSelected, reload }}>
      {children}
    </Ctx.Provider>
  );
}

export function useClients(): ClientContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('ClientProvider の内側で使用してください');
  return v;
}
