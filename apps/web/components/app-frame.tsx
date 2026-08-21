'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { AuthProvider } from '@/components/auth-context';
import { ClientProvider } from '@/components/client-context';
import { Shell } from '@/components/shell';

/** シェル (サイドバー・トップバー) を出さない画面 */
function isBarePath(pathname: string): boolean {
  return (
    pathname === '/login' ||
    pathname === '/signup' ||
    pathname.startsWith('/onboarding') ||
    pathname.startsWith('/report/print')
  );
}

/**
 * パス名でレイアウトを分岐する。
 * 認証・オンボーディング・印刷ビューは中央カード / 白紙レイアウト、
 * それ以外は 認証ゲート → クライアント一覧 → シェル の順に包む。
 */
export function AppFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  if (isBarePath(pathname)) return <>{children}</>;

  return (
    <AuthProvider>
      <ClientProvider>
        <Shell>{children}</Shell>
      </ClientProvider>
    </AuthProvider>
  );
}
