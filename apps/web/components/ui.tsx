'use client';

import type { CSSProperties, ReactNode } from 'react';
import type { Platform } from '@adgrid/shared';
import { PLATFORM_META } from '@adgrid/shared';
import { ApiError } from '@/lib/api';
import { PLATFORM_COLOR_VAR, PLATFORM_SHORT_LABEL } from '@/lib/labels';

/* ---- エラーカード: 原因 + 解決策 + 再試行 ---- */
export function ErrorCard({ error, onRetry }: { error: ApiError; onRetry?: () => void }) {
  return (
    <div className="alert bad" role="alert">
      <span className="a-ico" aria-hidden="true">●</span>
      <div>
        <span className="a-title">{error.message}</span>
        <br />
        <span className="a-body">{error.resolution}</span>
      </div>
      {onRetry ? (
        <span className="a-act">
          <button type="button" className="btn sm sec" onClick={onRetry}>再試行</button>
        </span>
      ) : null}
    </div>
  );
}

/* ---- スケルトン ---- */
export function Skeleton({ w, h, style }: { w?: string | number; h?: string | number; style?: CSSProperties }) {
  return <div className="skel" style={{ width: w, height: h, ...style }} aria-hidden="true" />;
}

export function SkeletonLines({ count = 3 }: { count?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} h={12} w={`${100 - (i % 3) * 15}%`} />
      ))}
    </div>
  );
}

/* ---- 空状態: この画面ですること + 主ボタン ---- */
export function EmptyState({ title, sub, action }: { title: string; sub: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="e-title">{title}</div>
      <div className="e-sub">{sub}</div>
      {action}
    </div>
  );
}

/* ---- 前週比 (色 + 矢印 + 数値の三重符号化。invert=低いほど良い指標) ---- */
function deltaParts(value: number | null, invert: boolean) {
  if (value === null) return { cls: 'flat', text: '— 前期なし' };
  if (Math.abs(value) < 1) return { cls: 'flat', text: `± ${Math.abs(value).toFixed(1)}%` };
  const arrow = value > 0 ? '▲' : '▼';
  const improved = invert ? value < 0 : value > 0;
  return { cls: improved ? 'up' : 'down', text: `${arrow} ${Math.abs(value).toFixed(1)}%` };
}

export function DeltaPill({ value, invert = false }: { value: number | null; invert?: boolean }) {
  const p = deltaParts(value, invert);
  return <span className={`pill ${p.cls}`}>{p.text}</span>;
}

export function DeltaText({ value, invert = false }: { value: number | null; invert?: boolean }) {
  const p = deltaParts(value, invert);
  return <span className={`delta ${p.cls}`}>{p.text}</span>;
}

/* ---- 媒体タグ (ブランド色ドットはタグ限定使用) ---- */
export function PlatformTag({ platform, full = false }: { platform: Platform; full?: boolean }) {
  return (
    <span className="tag">
      <span className="dot" style={{ background: PLATFORM_COLOR_VAR[platform] }} />
      {full ? PLATFORM_META[platform].label : PLATFORM_SHORT_LABEL[platform]}
    </span>
  );
}

export function MockBadge() {
  return <span className="pill warn" title="ANTHROPIC_API_KEY 未設定のためモック結果です">モック結果</span>;
}
