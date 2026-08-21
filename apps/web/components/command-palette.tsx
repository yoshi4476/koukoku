'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useClients } from '@/components/client-context';

interface PaletteItem {
  id: string;
  group: string;
  label: string;
  hint: string;
  /** ラベルに加えて検索対象にする文字列 (英語名・ローマ字など) */
  keywords: string;
  run: () => void;
}

const GROUP_ORDER = ['画面移動', 'クライアント', 'アクション'];

export function CommandPalette({
  open,
  onOpen,
  onClose,
}: {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const { clients, setSelectedClientId } = useClients();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const items = useMemo<PaletteItem[]>(() => {
    const nav: Array<{ label: string; href: string; keywords: string }> = [
      { label: 'ホーム', href: '/', keywords: 'home kanri 司令室' },
      { label: 'クライアント', href: '/clients', keywords: 'clients kuraianto 管理 一覧' },
      { label: 'ダッシュボード', href: '/dashboard', keywords: 'dashboard kpi' },
      { label: 'AI診断', href: '/audit', keywords: 'audit shindan 診断' },
      { label: 'レポート', href: '/report', keywords: 'report houkoku' },
      { label: '広告文', href: '/copy', keywords: 'copy koukokubun 生成' },
      { label: '媒体窓口', href: '/portal', keywords: 'portal baitai リンク' },
      { label: 'アラート', href: '/alerts', keywords: 'alerts arato 通知 検知 異常' },
      { label: 'データ取込', href: '/import', keywords: 'import csv torikomi' },
      { label: '設定', href: '/settings', keywords: 'settings settei' },
    ];
    const navItems: PaletteItem[] = nav.map((n) => ({
      id: `nav:${n.href}`,
      group: '画面移動',
      label: n.label,
      hint: '開く',
      keywords: n.keywords,
      run: () => router.push(n.href),
    }));
    const clientItems: PaletteItem[] = clients.map((c) => ({
      id: `client:${c.id}`,
      group: 'クライアント',
      label: c.name,
      hint: 'ダッシュボードを開く',
      keywords: 'client kuraianto',
      run: () => {
        setSelectedClientId(c.id);
        router.push('/dashboard');
      },
    }));
    const actionItems: PaletteItem[] = [
      {
        id: 'action:audit',
        group: 'アクション',
        label: '診断を実行',
        hint: 'AI診断へ',
        keywords: 'audit run shindan jikkou',
        run: () => router.push('/audit'),
      },
      {
        id: 'action:report',
        group: 'アクション',
        label: 'レポートを生成',
        hint: 'レポートへ',
        keywords: 'report run seisei',
        run: () => router.push('/report'),
      },
    ];
    return [...navItems, ...clientItems, ...actionItems];
  }, [clients, router, setSelectedClientId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) => i.label.toLowerCase().includes(q) || i.keywords.toLowerCase().includes(q),
    );
  }, [items, query]);

  /* ⌘K / Ctrl+K で開閉、Esc で閉じる (パレットは常時マウントされている) */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (open) onClose();
        else onOpen();
        return;
      }
      if (e.key === 'Escape' && open) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpen, onClose]);

  /* 開いたら初期化してフォーカス */
  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      // マウント直後の描画を待ってからフォーカスする
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  /* 選択項目を常に見える位置へ */
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, filtered.length]);

  if (!open) return null;

  const execute = (item: PaletteItem) => {
    onClose();
    item.run();
  };

  const onInputKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      // IME変換確定のEnterでは実行しない
      if (e.nativeEvent.isComposing) return;
      const item = filtered[activeIndex];
      if (item) execute(item);
    }
  };

  /* グループ見出し付きでフラットな index を保ったまま描画する */
  let flatIndex = -1;

  return (
    <div
      className="cp-overlay"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="cp" role="dialog" aria-modal="true" aria-label="コマンドパレット">
        <input
          ref={inputRef}
          className="cp-input"
          type="text"
          placeholder="画面名・クライアント名で検索…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onInputKeyDown}
          aria-label="コマンドを検索"
        />
        <div className="cp-list" ref={listRef} role="listbox">
          {filtered.length === 0 ? (
            <div className="cp-empty">
              「{query}」に一致する項目がありません。別の語で検索してください。
            </div>
          ) : (
            GROUP_ORDER.map((group) => {
              const groupItems = filtered.filter((i) => i.group === group);
              if (groupItems.length === 0) return null;
              return (
                <div key={group}>
                  <div className="cp-group">{group}</div>
                  {groupItems.map((item) => {
                    flatIndex += 1;
                    const idx = flatIndex;
                    return (
                      <button
                        type="button"
                        key={item.id}
                        data-index={idx}
                        className={`cp-item${idx === activeIndex ? ' on' : ''}`}
                        role="option"
                        aria-selected={idx === activeIndex}
                        onMouseEnter={() => setActiveIndex(idx)}
                        onClick={() => execute(item)}
                      >
                        {item.label}
                        <span className="cp-hint">{item.hint}</span>
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>
        <div className="cp-foot">
          <span><span className="kbd">↑↓</span> 選択</span>
          <span><span className="kbd">Enter</span> 実行</span>
          <span><span className="kbd">Esc</span> 閉じる</span>
        </div>
      </div>
    </div>
  );
}
