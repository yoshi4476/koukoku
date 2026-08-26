'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { AuthProvider } from '@/components/auth-context';
import { ClientProvider } from '@/components/client-context';
import { Shell } from '@/components/shell';
import { AdminShell } from '@/components/admin-shell';

/** シェル (サイドバー・トップバー) を出さない画面 */
function isBarePath(pathname: string): boolean {
  return (
    pathname === '/login' ||
    pathname === '/signup' ||
    // パスワード再設定は未ログインで開くため、認証ゲートを通さない (F-62)
    pathname === '/forgot' ||
    pathname === '/reset' ||
    pathname.startsWith('/onboarding') ||
    pathname.startsWith('/report/print') ||
    pathname.startsWith('/share/')
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

  // システム管理 (F-61) はテナント運用のシェルを使わない。
  // ClientProvider も通さない (運営者はテナントのクライアント一覧を持たないため)
  if (pathname.startsWith('/admin')) {
    return (
      <AuthProvider>
        <AdminShell>{children}</AdminShell>
      </AuthProvider>
    );
  }

  return (
    <AuthProvider>
      <ClientProvider>
        <Shell>{children}</Shell>
      </ClientProvider>
    </AuthProvider>
  );
}
