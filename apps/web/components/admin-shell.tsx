'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useAuth } from '@/components/auth-context';

/**
 * システム管理画面 (F-61) 専用シェル。
 *
 * テナント運用のサイドバーとは意図的に別物にしてある。運営者が「いま自分は
 * 全社を横断して見ている」と一目で分かることが誤操作を防ぐため、
 * 上部に濃い管理バーを置き、テナント側の画面へ戻る導線を必ず出す。
 */
export function AdminShell({ children }: { children: ReactNode }) {
  const { me, logout, loggingOut } = useAuth();

  if (!me.platformAdmin) {
    return (
      <div className="adm-deny">
        <div className="card" style={{ maxWidth: 520 }}>
          <div className="c-head"><h2>アクセスできません</h2></div>
          <div className="c-body">
            <p style={{ margin: 0, lineHeight: 1.9 }}>
              このページはサービス運営者専用です。
              <br />
              <span style={{ color: 'var(--muted)', fontSize: 13 }}>
                ログイン中: {me.email}
              </span>
            </p>
            <div style={{ marginTop: 16 }}>
              <Link className="btn pri" href="/">運用画面に戻る</Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="adm">
      <header className="adm-bar">
        <span className="adm-logo">ADGRID</span>
        <span className="adm-tag">システム管理</span>
        <nav className="adm-nav">
          <Link href="/admin">テナント</Link>
          <Link href="/admin/health">システム状態</Link>
        </nav>
        <span className="adm-who">{me.email}</span>
        <Link className="btn sm sec" href="/">運用画面へ</Link>
        <button type="button" className="btn sm sec" onClick={logout} disabled={loggingOut}>
          {loggingOut ? '…' : 'ログアウト'}
        </button>
      </header>
      <main className="adm-main">{children}</main>
    </div>
  );
}
