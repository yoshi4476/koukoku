'use client';

import { useMemo, useState } from 'react';
import type {
  AuditRunDto,
  ChangeLogDto,
  KeywordOptimizeDto,
  PacingDto,
  ProjectAccountDto,
} from '@adgrid/shared';
import { useApi } from '@/components/use-api';
import { ErrorCard, MockBadge, PlatformTag, SkeletonLines } from '@/components/ui';
import { apiPost, toApiError, type ApiError } from '@/lib/api';
import { CHANGELOG_ACTOR_META } from '@/lib/labels';
import { formatDate, formatDateTime, formatPercent, formatYen } from '@/lib/format';

/** 折りたたみ可能なツールパネル。既定で最初の1つだけ開く */
function Tool({ title, desc, badge, defaultOpen, children }: {
  title: string; desc: string; badge?: React.ReactNode; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="c-head">
        <h2>{title}</h2>
        {badge}
        <button type="button" className="btn sm sec" style={{ marginLeft: 'auto' }} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? '閉じる' : '開く'}
        </button>
      </div>
      {open ? <div className="c-body">{children}</div> : <div className="c-body" style={{ paddingTop: 0, color: 'var(--muted)', fontSize: 12.5 }}>{desc}</div>}
    </div>
  );
}

/* ---------------- AI診断 ---------------- */
function AuditTool({ accounts }: { accounts: ProjectAccountDto[] }) {
  const [accountId, setAccountId] = useState(accounts[0]?.adAccountId ?? '');
  const audits = useApi<AuditRunDto[]>(accountId ? `/audits?adAccountId=${encodeURIComponent(accountId)}` : null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const latest = (audits.data ?? [])[0] ?? null;

  const run = () => {
    if (!accountId) return;
    setRunning(true); setError(null);
    apiPost<AuditRunDto>('/audits/run', { adAccountId: accountId })
      .then(() => audits.retry())
      .catch((e: unknown) => setError(toApiError(e)))
      .finally(() => setRunning(false));
  };

  if (accounts.length === 0) return <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13 }}>このプロジェクトに媒体アカウントがありません。</p>;

  return (
    <>
      <div className="deliver-row" style={{ marginBottom: 12 }}>
        <select className="select" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
          {accounts.map((a) => <option key={a.adAccountId} value={a.adAccountId}>{a.name}</option>)}
        </select>
        <button type="button" className="btn sm pri" onClick={run} disabled={running || !accountId}>
          {running ? '診断中…' : latest ? '再診断する' : 'AI診断を実行'}
        </button>
        {latest ? <span className="num" style={{ fontSize: 11.5, color: 'var(--muted)' }}>最終 {formatDateTime(latest.createdAt)}</span> : null}
        {latest?.mocked ? <MockBadge /> : null}
      </div>
      {error ? <ErrorCard error={error} onRetry={run} /> : null}
      {audits.loading ? <SkeletonLines count={3} /> : null}
      {latest ? (
        <>
          <p style={{ margin: '0 0 12px', fontSize: 13, lineHeight: 1.8 }}>{latest.result.summary}</p>
          <div className="findings-lite">
            {latest.result.findings.slice(0, 5).map((f) => {
              const st = latest.findingStatuses[f.priority_rank] ?? 'open';
              return (
                <div key={f.priority_rank} className={`finding-lite st-${st}`}>
                  <div className="fl-head">
                    <span className="fl-rank">#{f.priority_rank}</span>
                    <span className="fl-title">{f.title}</span>
                    <span className={`pill ${f.confidence === 'high' ? 'up' : f.confidence === 'mid' ? 'warn' : 'flat'}`}>確信度 {f.confidence}</span>
                    {st !== 'open' ? <span className="pill flat">{st === 'adopted' ? '採用済' : '見送り'}</span> : null}
                  </div>
                  <div className="fl-body">{f.body}</div>
                  <div className="fl-meta">効果: {f.expected_impact}／リスク: {f.risk}</div>
                </div>
              );
            })}
          </div>
        </>
      ) : audits.data ? <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13 }}>まだ診断がありません。「AI診断を実行」で改善点を洗い出せます。</p> : null}
    </>
  );
}

/* ---------------- キーワード最適化 ---------------- */
function KeywordTool({ clientId }: { clientId: string }) {
  const kw = useApi<KeywordOptimizeDto>(`/keywords/optimize?clientId=${encodeURIComponent(clientId)}`);
  const d = kw.data;
  if (kw.loading) return <SkeletonLines count={3} />;
  if (kw.error) return <ErrorCard error={kw.error} onRetry={kw.retry} />;
  if (!d || d.totalKeywords === 0) return <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13 }}>キーワード実績がまだありません（媒体同期後に表示されます）。</p>;

  return (
    <>
      <div className="reall-summary" style={{ marginBottom: 12 }}>
        <div><div className="rs-l">増額推奨</div><div className="rs-v up">{d.summary.increaseCount}<span className="rs-u">件</span></div></div>
        <div><div className="rs-l">減額・停止</div><div className="rs-v">{d.summary.decreaseCount + d.summary.pauseCount}<span className="rs-u">件</span></div></div>
        <div><div className="rs-l">浮く予算</div><div className="rs-v">{formatYen(d.summary.reclaimableBudget)}<span className="rs-u">/月</span></div></div>
        <div><div className="rs-l">見込CV増</div><div className="rs-v up">+{d.summary.projectedCvGain}<span className="rs-u">件/月</span></div></div>
      </div>
      <p className="reall-note">{d.industryLabel}の相場と比較し、{d.totalKeywords}語を{d.windowDays}日分の実績で評価しています。</p>
      <div className="kw-ranks">
        {([['最高ROI', d.topRoi], ['バランス最良', d.bestBalance], ['最高CTR', d.topCtr]] as const).map(([label, items]) => (
          <div className="kw-rank" key={label}>
            <div className="kw-rank-h">{label}</div>
            {items.slice(0, 3).map((it, i) => (
              <div className="kw-rank-row" key={`${label}-${i}`}>
                <span className="kw-rank-n">{i + 1}</span>
                <span className="kw-rank-kw">{it.keyword}</span>
                <span className="kw-rank-m num">{it.metricLabel}</span>
              </div>
            ))}
            {items.length === 0 ? <div className="kw-rank-row" style={{ color: 'var(--muted)' }}>該当なし</div> : null}
          </div>
        ))}
      </div>
    </>
  );
}

/* ---------------- 予算ペース ---------------- */
function PacingTool({ accounts }: { accounts: ProjectAccountDto[] }) {
  const pacing = useApi<PacingDto[]>('/pacing');
  const ids = useMemo(() => new Set(accounts.map((a) => a.adAccountId)), [accounts]);
  const rows = (pacing.data ?? []).filter((p) => ids.has(p.adAccountId));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const propose = () => {
    setBusy(true); setMsg('');
    apiPost<{ created: number; skipped: number; scanned: number }>('/pacing/propose', {})
      .then((r) => setMsg(r.created > 0
        ? `${r.created}件の予算提案を承認キューに作成しました。`
        : r.scanned > 0 ? '対象はすでに保留中の提案があります。' : '予算逸脱は見つかりませんでした。'))
      .catch((e: unknown) => setMsg(toApiError(e).message))
      .finally(() => setBusy(false));
  };

  if (pacing.loading) return <SkeletonLines count={2} />;
  if (pacing.error) return <ErrorCard error={pacing.error} onRetry={pacing.retry} />;
  if (rows.length === 0) return <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13 }}>月予算が設定されたアカウントがありません。「② 配信設定」で月予算を設定すると着地予測が出ます。</p>;

  return (
    <>
      <div className="tbl-scroll">
        <table className="data-tbl">
          <thead><tr><th>アカウント</th><th>月予算</th><th>当月消化</th><th>着地予測</th><th>推奨日予算</th><th>状態</th></tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.adAccountId}>
                <td><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><PlatformTag platform={p.platform} /><span>{p.accountName}</span></div></td>
                <td>{formatYen(p.monthlyBudget)}</td>
                <td>{formatYen(p.monthToDateCost)}</td>
                <td>{formatYen(p.projectedMonthEnd)} <span className={`pill ${p.status === 'over' ? 'down' : p.status === 'under' ? 'warn' : 'up'}`}>{formatPercent(p.projectedPct, 0)}</span></td>
                <td>{formatYen(p.recommendedDailyBudget)}</td>
                <td>{p.runOutDate ? <span style={{ color: 'var(--bad)', fontSize: 12 }}>{formatDate(p.runOutDate)}に予算到達</span> : <span style={{ color: 'var(--muted)', fontSize: 12 }}>—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="deliver-row" style={{ marginTop: 12 }}>
        <button type="button" className="btn sm pri" onClick={propose} disabled={busy}>{busy ? '作成中…' : '予算調整を承認キューへ提案'}</button>
        {msg ? <span style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>{msg}</span> : null}
      </div>
    </>
  );
}

/* ---------------- 変更履歴 ---------------- */
function ChangeLogTool({ clientId }: { clientId: string }) {
  const log = useApi<ChangeLogDto[]>(`/changelog?clientId=${encodeURIComponent(clientId)}`);
  const items = (log.data ?? []).slice(0, 12);
  if (log.loading) return <SkeletonLines count={3} />;
  if (log.error) return <ErrorCard error={log.error} onRetry={log.retry} />;
  if (items.length === 0) return <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13 }}>変更履歴はまだありません。</p>;

  const fmt = (field: string, v: string) => (!v ? '—' : field === 'budget' && Number.isFinite(Number(v)) ? formatYen(Number(v)) : v);
  return (
    <ol className="timeline">
      {items.map((c) => {
        const actor = CHANGELOG_ACTOR_META[c.actor];
        return (
          <li className="tl-item" key={c.id}>
            <span className={`tl-dot${c.actor === 'adgrid' ? ' adgrid' : ''}`} aria-hidden="true" />
            <div className="tl-body">
              <div className="tl-head">
                <span className="tl-time num">{formatDateTime(c.changedAt)}</span>
                <span className={`pill ${actor.cls}`}>{actor.label}</span>
                <PlatformTag platform={c.platform} />
                <span className="tl-acct">{c.accountName}</span>
              </div>
              <div className="tl-change">
                <span className="tl-entity">{c.entity}の{c.field}</span>
                <span className="tl-values num">
                  <span className="tl-old">{fmt(c.field, c.oldValue)}</span>
                  <span className="tl-arrow" aria-hidden="true">→</span>
                  <span className="tl-new">{fmt(c.field, c.newValue)}</span>
                </span>
              </div>
              {c.note ? <div className="tl-note">{c.note}</div> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * 改善タブに統合した最適化ツール群 (F-53)。
 * プロジェクトを離れずに 診断 → キーワード → 予算ペース → 変更履歴 まで完結させる。
 */
export function ImproveTools({ clientId, accounts, openFindings }: {
  clientId: string; accounts: ProjectAccountDto[]; openFindings: number;
}) {
  return (
    <>
      <Tool
        title="🩺 AI診断"
        desc="アカウントの構造・予算・入札・計測を診断し、優先順位つきで改善点を出します。"
        badge={openFindings > 0 ? <span className="pill warn">未対応 {openFindings}件</span> : null}
        defaultOpen
      >
        <AuditTool accounts={accounts} />
      </Tool>

      <Tool title="🔍 キーワード最適化" desc="業種相場と比べて、増額・減額・停止すべきキーワードを判定します。">
        <KeywordTool clientId={clientId} />
      </Tool>

      <Tool title="📈 予算ペース" desc="月予算に対する着地予測。超過・未消化を早期に見つけて調整提案まで出せます。">
        <PacingTool accounts={accounts} />
      </Tool>

      <Tool title="🕒 変更履歴" desc="ADGRID経由の変更と媒体側の変更を統合表示。実績が動いた要因の特定に使えます。">
        <ChangeLogTool clientId={clientId} />
      </Tool>
    </>
  );
}
