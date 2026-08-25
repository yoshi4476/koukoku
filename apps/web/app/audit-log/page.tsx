'use client';

import { useState } from 'react';
import type { AuditEventDto } from '@adgrid/shared';
import { AUDIT_FILTERS, AUDIT_SEVERITY_LABEL, auditActionMeta } from '@adgrid/shared';
import { useApi } from '@/components/use-api';
import { EmptyState, ErrorCard, HintBar, SkeletonLines } from '@/components/ui';
import { formatDateTime } from '@/lib/format';

/** href に使ってよいのは http(s) のみ (javascript: 等のスキームを弾く) */
function safeHref(u: unknown): string | null {
  return typeof u === 'string' && /^https?:\/\//i.test(u) ? u : null;
}

/** 監査ログ内の重要フィールドを人間可読に整形する */
function detailChips(action: string, detail: Record<string, unknown>): string[] {
  const chips: string[] = [];
  const push = (v: unknown, suffix = '') => {
    if (v !== undefined && v !== null && v !== '') chips.push(`${String(v)}${suffix}`);
  };
  if ('title' in detail) push(detail.title);
  if ('name' in detail) push(detail.name);
  if ('channel' in detail) push(detail.channel === 'slack' ? 'Slack配信' : '共有リンク');
  if ('value' in detail && typeof detail.value === 'number') push(`¥${detail.value.toLocaleString('ja-JP')}`);
  if ('periodType' in detail) push(detail.periodType === 'weekly' ? '週次' : detail.periodType === 'monthly' ? '月次' : detail.periodType);
  if ('type' in detail) push(detail.type);
  return chips.slice(0, 3);
}

function EventRow({ ev }: { ev: AuditEventDto }) {
  const meta = auditActionMeta(ev.action);
  const chips = detailChips(ev.action, ev.detail);
  const url = safeHref(ev.detail.url);
  return (
    <li className={`al-item sev-${meta.severity}`}>
      <span className="al-icon" aria-hidden="true">{meta.icon}</span>
      <div className="al-body">
        <div className="al-head">
          <span className="al-action">{meta.label}</span>
          <span className={`al-sev sev-${meta.severity}`}>{AUDIT_SEVERITY_LABEL[meta.severity]}</span>
          <span className="al-time num">{formatDateTime(ev.createdAt)}</span>
        </div>
        <div className="al-meta">
          <span className="al-actor">{ev.actorName}</span>
          {chips.map((c, i) => (
            <span key={i} className="tag">{c}</span>
          ))}
          {url ? (
            <a className="al-link" href={url} target="_blank" rel="noopener noreferrer">リンク ↗</a>
          ) : null}
        </div>
      </div>
    </li>
  );
}

export default function AuditLogPage() {
  const [action, setAction] = useState('');
  const path = `/audit-log${action ? `?action=${encodeURIComponent(action)}` : ''}`;
  const log = useApi<AuditEventDto[]>(path);
  const items = log.data ?? [];

  return (
    <>
      <div className="page-h">
        <h1>監査ログ</h1>
        <span className="sub">「いつ・誰が・何をしたか」を記録します。ログイン・提案の適用・公開・レポート配信・共有リンクなどを追跡できます</span>
      </div>

      <HintBar id="audit-log" title="監査ログの使い方">
        重要操作(<mark>ログイン・提案の適用/ロールバック・広告公開・レポート配信・共有リンク発行</mark>など)を時系列で記録します。ガバナンス確認や、実績が動いた要因の特定に使えます。閲覧はオーナー/管理者のみ。
      </HintBar>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="c-body row-actions">
          <div className="field">
            <label htmlFor="al-filter">操作で絞り込む</label>
            <select id="al-filter" className="select" value={action} onChange={(e) => setAction(e.target.value)}>
              {AUDIT_FILTERS.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {log.error ? <ErrorCard error={log.error} onRetry={log.retry} /> : null}

      {log.loading ? (
        <div className="card"><div className="c-body"><SkeletonLines count={6} /></div></div>
      ) : null}

      {items.length > 0 ? (
        <div className="card">
          <div className="c-body">
            <ol className="audit-log">
              {items.map((ev) => (
                <EventRow key={ev.id} ev={ev} />
              ))}
            </ol>
          </div>
        </div>
      ) : null}

      {log.data && items.length === 0 ? (
        <EmptyState title="該当する監査ログはありません" sub="操作が行われると自動で記録されます。" />
      ) : null}
    </>
  );
}
