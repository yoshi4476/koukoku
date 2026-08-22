'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { editionAllows, EDITION_LABEL, type EditionFeature } from '@adgrid/shared';
import { useAuth } from '@/components/auth-context';
import { useClients } from '@/components/client-context';
import { CommandPalette } from '@/components/command-palette';

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
}

/** 版で出し分けするナビ (提供先版で隠す運用/管理系画面) */
const HREF_FEATURE: Record<string, EditionFeature> = {
  '/approvals': 'approvals',
  '/connections': 'connections',
  '/import': 'imports',
  '/knowledge': 'knowledge',
};

// 提供先版テナント(edition=client)では管理系(クライアント管理・テナント発行)も隠す
const CLIENT_EDITION_HIDE = new Set(['/clients', '/reseller']);

const NAV_MAIN: NavItem[] = [
  {
    href: '/',
    label: 'ホーム',
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <path d="M2 7 7 2l5 5v5H8V9H6v3H2z" fill="currentColor" />
      </svg>
    ),
  },
  {
    href: '/projects',
    label: 'プロジェクト',
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <rect x="1.8" y="2.5" width="10.4" height="9" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <path d="M1.8 5h10.4M4.5 2.5v2.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <path d="M4 7.5h3.5M4 9.3h5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: '/clients',
    label: 'クライアント',
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <circle cx="7" cy="4.5" r="2.3" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M2.5 12c.7-2.4 2.5-3.6 4.5-3.6s3.8 1.2 4.5 3.6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: '/dashboard',
    label: 'ダッシュボード',
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <path d="M2 12V6h2v6zm4 0V2h2v10zm4 0V8h2v4z" fill="currentColor" />
      </svg>
    ),
  },
  {
    href: '/boards',
    label: 'カスタムボード',
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <rect x="2" y="2" width="4.5" height="6" rx="1" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <rect x="7.5" y="2" width="4.5" height="3.5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <rect x="2" y="9.5" width="4.5" height="2.5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <rect x="7.5" y="6.5" width="4.5" height="5.5" rx="1" fill="none" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    ),
  },
  {
    href: '/audit',
    label: 'AI診断',
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M7 4v3l2 2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    ),
  },
  {
    href: '/report',
    label: 'レポート',
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <path d="M3 2h8v10H3z M5 5h4M5 7h4M5 9h2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    ),
  },
  {
    href: '/copy',
    label: '広告文',
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <path d="M2 3h10M2 7h7M2 11h9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: '/abtests',
    label: 'A/Bテスト',
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <path d="M5.5 1.5v4L2.6 10.6A1 1 0 0 0 3.5 12h7a1 1 0 0 0 .9-1.4L8.5 5.5v-4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M4.5 1.5h5M4.6 8h4.8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: '/knowledge',
    label: '勝ちパターン',
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <path d="M3.5 2h7v2a3.5 3.5 0 0 1-7 0z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M3.5 3H2v1a1.5 1.5 0 0 0 1.5 1.5M10.5 3H12v1a1.5 1.5 0 0 1-1.5 1.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        <path d="M7 7.5V10M5 12h4M5.5 12a1.5 1.5 0 0 1 3 0" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    href: '/keywords',
    label: 'キーワード最適化',
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <circle cx="6" cy="6" r="4" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <path d="M9 9l3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        <path d="M4.4 6.2l1.1 1.1 2.1-2.4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    href: '/pacing',
    label: '予算ペース',
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <path d="M2 10.5a5 5 0 1 1 10 0" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        <path d="M7 10.5 9.7 6.3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        <circle cx="7" cy="10.5" r="1.1" fill="currentColor" />
      </svg>
    ),
  },
  {
    href: '/calendar',
    label: 'カレンダー',
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <rect x="2" y="3" width="10" height="9" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.3" />
        <path d="M2 5.5h10M4.5 2v2M9.5 2v2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: '/experiments',
    label: '増分効果テスト',
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <path d="M5.5 2v3.2L3 10.2a1.3 1.3 0 0 0 1.2 1.9h5.6A1.3 1.3 0 0 0 11 10.2L8.5 5.2V2" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        <path d="M4.5 2h5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: '/portal',
    label: '媒体窓口',
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <rect x="2" y="2" width="4" height="4" rx="1" fill="currentColor" />
        <rect x="8" y="2" width="4" height="4" rx="1" fill="currentColor" />
        <rect x="2" y="8" width="4" height="4" rx="1" fill="currentColor" />
        <rect x="8" y="8" width="4" height="4" rx="1" fill="currentColor" />
      </svg>
    ),
  },
  {
    href: '/alerts',
    label: 'アラート',
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <path
          d="M7 1.8a3.4 3.4 0 0 0-3.4 3.4c0 2.5-.8 3.5-1.3 4.1h9.4c-.5-.6-1.3-1.6-1.3-4.1A3.4 3.4 0 0 0 7 1.8z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <path d="M5.7 11.5a1.4 1.4 0 0 0 2.6 0" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: '/approvals',
    label: '承認キュー',
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <path
          d="M7 1.5 11.5 3v3.2c0 2.9-1.9 5.1-4.5 6.3-2.6-1.2-4.5-3.4-4.5-6.3V3z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <path d="m5 7 1.5 1.5L9 5.8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
];

const NAV_DATA: NavItem[] = [
  {
    href: '/import',
    label: 'データ取込',
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <path d="M7 2v6M4.5 5.5 7 8l2.5-2.5M3 11h8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: '/changelog',
    label: '変更履歴',
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <circle cx="7" cy="7" r="5" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <path d="M7 4v3l2 1.4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
];

const NAV_SETTINGS: NavItem[] = [
  {
    href: '/connections',
    label: 'API接続',
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <path d="M4.5 1.5v3M9.5 1.5v3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M3 4.5h8v1.5a4 4 0 0 1-4 4 4 4 0 0 1-4-4z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M7 10v2.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: '/settings',
    label: '設定',
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <circle cx="7" cy="7" r="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path
          d="M7 1v2M7 11v2M1 7h2M11 7h2M3 3l1.4 1.4M9.6 9.6 11 11M11 3 9.6 4.4M4.4 9.6 3 11"
          stroke="currentColor"
          strokeWidth="1.3"
        />
      </svg>
    ),
  },
  {
    href: '/guide',
    label: '使い方ガイド',
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <path d="M2 2.5h3.2c.9 0 1.8.4 1.8 1.3v8c0-.7-.9-1-1.8-1H2z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
        <path d="M12 2.5H8.8C7.9 2.5 7 2.9 7 3.8v8c0-.7.9-1 1.8-1H12z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    href: '/feedback',
    label: 'フィードバック',
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <path d="M2 3.5h10v6H6l-2.5 2v-2H2z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    href: '/reseller',
    label: '提供先テナント',
    icon: (
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
        <rect x="1.5" y="6" width="4.5" height="6" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
        <rect x="8" y="2" width="4.5" height="10" rx="1" fill="none" stroke="currentColor" strokeWidth="1.3" />
        <path d="M6 9h2" fill="none" stroke="currentColor" strokeWidth="1.3" />
      </svg>
    ),
  },
];

// 広告運用の手順どおりにメニューを並べ替える (準備→作る→見る→直す→報告)。
// 既存のアイコン定義を href で参照して再構成する。
const NAV_LOOKUP: Record<string, NavItem> = Object.fromEntries(
  [...NAV_MAIN, ...NAV_DATA, ...NAV_SETTINGS].map((n) => [n.href, n]),
);

interface NavPhase {
  label: string | null;
  hrefs: string[];
}

// プロジェクト中心のシンプルなナビ。掲示・推移・アラート・改善はプロジェクト詳細に集約し、
// グローバルには「横断で使うもの」だけを残す。
const NAV_PHASES: NavPhase[] = [
  { label: null, hrefs: ['/', '/projects'] },
  { label: '作る（横断）', hrefs: ['/copy', '/knowledge'] },
  { label: '報告する', hrefs: ['/report'] },
  { label: '管理・設定', hrefs: ['/clients', '/reseller', '/feedback', '/settings', '/guide'] },
];

// 提供先(client)アクセス専用の最小ナビ (自分のクライアントの閲覧+フィードバックのみ)
const CLIENT_NAV_PHASES: NavPhase[] = [
  { label: null, hrefs: ['/projects', '/report'] },
  { label: null, hrefs: ['/feedback'] },
];

function NavLinks({ items, pathname }: { items: NavItem[]; pathname: string }) {
  return (
    <>
      {items.map((item) => {
        const on = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
        return (
          <Link key={item.href} href={item.href} className={`nav-item${on ? ' on' : ''}`} aria-current={on ? 'page' : undefined}>
            {item.icon}
            {item.label}
          </Link>
        );
      })}
    </>
  );
}

function AvatarMenu() {
  const { me, loggingOut, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  /* メニュー外クリックで閉じる */
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const initial = me.name.trim().charAt(0) || me.email.charAt(0).toUpperCase();

  return (
    <div className="avatar-wrap" ref={wrapRef}>
      <button
        type="button"
        className="avatar"
        title={me.name}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {initial}
      </button>
      {open ? (
        <div className="avatar-menu" role="menu">
          <div className="am-head">
            <div className="am-name">{me.name}</div>
            <div className="am-sub">{me.tenantName}</div>
            <div className="am-sub">{me.email}</div>
          </div>
          <button type="button" className="am-item" role="menuitem" disabled={loggingOut} onClick={logout}>
            {loggingOut ? 'ログアウト中…' : 'ログアウト'}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { me, switchTenant } = useAuth();
  const { clients, selectedClientId, setSelectedClientId } = useClients();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const clientScoped = me.clientScopeId != null;
  const phases = clientScoped ? CLIENT_NAV_PHASES : NAV_PHASES;
  const multiTenant = me.switchableTenants.length > 1;

  return (
    <div className="app">
      <aside className="sidebar">
        <Link href={clientScoped ? '/projects' : '/'} className="brand">
          AD<span className="bx">GRID</span>
        </Link>
        {me.edition === 'client' ? (
          <div className="edition-badge" title="提供先版: 自社データの閲覧が中心の画面構成です">
            {clientScoped && me.clientScopeName ? me.clientScopeName : EDITION_LABEL[me.edition]}
          </div>
        ) : null}
        {phases.map((phase, i) => {
          const items = phase.hrefs
            .filter((h) => {
              if (me.edition === 'client' && CLIENT_EDITION_HIDE.has(h)) return false;
              const f = HREF_FEATURE[h];
              return !f || editionAllows(me.edition, f);
            })
            .map((h) => NAV_LOOKUP[h])
            .filter(Boolean);
          if (items.length === 0) return null;
          return (
            <div key={phase.label ?? `p${i}`}>
              {phase.label ? <div className="nav-sep">{phase.label}</div> : null}
              <NavLinks items={items} pathname={pathname} />
            </div>
          );
        })}
      </aside>
      <div className="main">
        <div className="topbar">
          {multiTenant ? (
            <select
              className="tenant-sw"
              value={me.tenantId}
              onChange={(e) => { if (e.target.value !== me.tenantId) switchTenant(e.target.value); }}
              aria-label="テナントを切り替える"
              title="テナント(自社/提供先)を切り替える"
            >
              {me.switchableTenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.isChild ? '🏷 ' : '🏢 '}{t.name}
                </option>
              ))}
            </select>
          ) : null}
          {clientScoped ? (
            <span className="client-fixed">{me.clientScopeName ?? 'マイアカウント'}</span>
          ) : (
            <select
              className="client-sw"
              value={selectedClientId}
              onChange={(e) => setSelectedClientId(e.target.value)}
              aria-label="クライアントで絞り込む"
            >
              <option value="">クライアント: すべて</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          {clientScoped ? null : (
            <button type="button" className="cmdk" title="コマンドパレットを開く" onClick={() => setPaletteOpen(true)}>
              クライアント・機能を検索… <span className="kbd">⌘K</span>
            </button>
          )}
          <AvatarMenu />
        </div>
        <main className="content">{children}</main>
      </div>
      <CommandPalette
        open={paletteOpen}
        onOpen={() => setPaletteOpen(true)}
        onClose={() => setPaletteOpen(false)}
      />
    </div>
  );
}
