'use client';

import { use, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { DailyPointDto, ProjectDetailDto } from '@adgrid/shared';
import { PROJECT_GOAL_LABEL, PROJECT_STATUS_LABEL } from '@adgrid/shared';
import { useApi } from '@/components/use-api';
import { useClients } from '@/components/client-context';
import { DeltaText, ErrorCard, PlatformTag, SkeletonLines } from '@/components/ui';
import { CONNECTION_STATUS_META, INDUSTRY_LABEL } from '@/lib/labels';
import { formatDate, formatDateTime, formatNumber, formatPercent, formatYen } from '@/lib/format';

type Tab = 'overview' | 'delivery' | 'alerts' | 'improve';
const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: '概要（推移）' },
  { key: 'delivery', label: '掲示' },
  { key: 'alerts', label: 'アラート' },
  { key: 'improve', label: '改善' },
];

const STATUS_CLS: Record<string, string> = { active: 'up', paused: 'warn', ended: 'flat' };

/* コスト推移の小さな折れ線 */
function TrendChart({ points }: { points: DailyPointDto[] }) {
  if (points.length < 2) return <p style={{ color: 'var(--muted)', fontSize: 13 }}>推移データがありません。</p>;
  const w = 640, h = 140, pad = 8;
  const max = Math.max(...points.map((p) => p.cost), 1);
  const step = (w - pad * 2) / (points.length - 1);
  const y = (v: number) => h - pad - (v / max) * (h - pad * 2);
  const line = points.map((p, i) => `${pad + i * step},${y(p.cost)}`).join(' ');
  const area = `${pad},${h - pad} ${line} ${pad + (points.length - 1) * step},${h - pad}`;
  return (
    <div className="tbl-scroll">
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none" role="img" aria-label="消化額の推移">
        <polygon points={area} fill="var(--primary-soft)" />
        <polyline points={line} fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinejoin="round" />
        {points.map((p, i) => (
          <circle key={p.date} cx={pad + i * step} cy={y(p.cost)} r="2.5" fill="var(--primary)">
            <title>{`${formatDate(p.date)}: ${formatYen(p.cost)} / CV ${formatNumber(p.conversions)}`}</title>
          </circle>
        ))}
      </svg>
    </div>
  );
}

export default function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { setSelectedClientId } = useClients();
  const detail = useApi<ProjectDetailDto>(`/projects/${id}`);
  const [tab, setTab] = useState<Tab>('overview');
  const d = detail.data;

  const kpiCards = useMemo(() => {
    if (!d) return [];
    const k = d.kpi;
    return [
      { label: '消化額 (7日)', value: formatYen(k.cost), delta: k.deltas.cost, invert: true },
      { label: 'CV', value: formatNumber(k.conversions), delta: k.deltas.conversions, invert: false },
      { label: 'CPA', value: formatYen(k.cpa), delta: k.deltas.cpa, invert: true },
      { label: 'ROAS', value: k.roas === null ? '—' : `${Math.round(k.roas)}%`, delta: k.deltas.roas, invert: false },
    ];
  }, [d]);

  /* 改善アクション: クライアント文脈を合わせて各画面へ */
  const goFiltered = (href: string) => {
    if (d) setSelectedClientId(d.clientId);
    router.push(href);
  };

  return (
    <>
      <div className="page-h">
        <Link href="/projects" className="btn sm sec">← プロジェクト一覧</Link>
        <h1 style={{ marginLeft: 4 }}>{d ? d.name : 'プロジェクト'}</h1>
        {d ? <span className={`pill ${STATUS_CLS[d.status] ?? 'flat'}`}>{PROJECT_STATUS_LABEL[d.status]}</span> : null}
      </div>

      {detail.error ? <ErrorCard error={detail.error} onRetry={detail.retry} /> : null}
      {detail.loading ? <div className="card"><div className="c-body"><SkeletonLines count={5} /></div></div> : null}

      {d ? (
        <>
          <div className="proj-meta">
            <span>🏢 {d.clientName}</span>
            <span className="proj-ind">{INDUSTRY_LABEL[d.industryCode] ?? d.industryCode}</span>
            <span>🎯 {PROJECT_GOAL_LABEL[d.goal]}</span>
            <span>📺 媒体{d.accounts.length}件</span>
            {d.note ? <span className="proj-note">{d.note}</span> : null}
          </div>

          <div className="tabs proj-tabs">
            {TABS.map((t) => (
              <button key={t.key} className={`tab ${tab === t.key ? 'on' : ''}`} onClick={() => setTab(t.key)}>
                {t.label}
                {t.key === 'alerts' && d.alerts.length > 0 ? <span className="wtab-count">{d.alerts.length}</span> : null}
                {t.key === 'improve' && d.openFindings > 0 ? <span className="wtab-count">{d.openFindings}</span> : null}
              </button>
            ))}
          </div>

          {/* --- 概要（推移） --- */}
          {tab === 'overview' ? (
            <>
              <div className="kpis">
                {kpiCards.map((c) => (
                  <div className="kpi" key={c.label}>
                    <div className="k-label">{c.label}</div>
                    <div className="k-val">{c.value}</div>
                    <div className="k-foot"><DeltaText value={c.delta} invert={c.invert} /></div>
                  </div>
                ))}
              </div>
              <div className="card">
                <div className="c-head"><h2>消化額の推移 (直近14日)</h2>
                  <button className="btn sm sec" style={{ marginLeft: 'auto' }} onClick={() => goFiltered('/dashboard')}>詳しいダッシュボードへ</button>
                </div>
                <div className="c-body"><TrendChart points={d.trend} /></div>
              </div>
            </>
          ) : null}

          {/* --- 掲示 --- */}
          {tab === 'delivery' ? (
            <div className="card">
              <div className="c-head"><h2>掲示（配信中の媒体）</h2>
                <button className="btn sm sec" style={{ marginLeft: 'auto' }} onClick={() => goFiltered('/connections')}>媒体接続を管理</button>
              </div>
              <div className="c-body tbl-scroll" style={{ padding: 0 }}>
                <table className="data-tbl">
                  <thead><tr><th>媒体アカウント</th><th>接続</th><th>月予算</th><th>消化(7日)</th><th>CV</th><th>CPA</th></tr></thead>
                  <tbody>
                    {d.accounts.map((a) => {
                      const cs = CONNECTION_STATUS_META[a.connectionStatus];
                      return (
                        <tr key={a.adAccountId}>
                          <td><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><PlatformTag platform={a.platform} /><span>{a.name}</span></div></td>
                          <td><span className="pill" style={{ background: 'var(--bg-sub)', color: cs.colorVar }}>{cs.label}</span></td>
                          <td>{formatYen(a.monthlyBudget)}</td>
                          <td>{formatYen(a.cost7d)}</td>
                          <td>{formatNumber(a.conversions7d)}</td>
                          <td>{formatYen(a.cpa7d)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {/* --- アラート --- */}
          {tab === 'alerts' ? (
            <div className="card">
              <div className="c-head"><h2>このプロジェクトのアラート</h2>
                <button className="btn sm sec" style={{ marginLeft: 'auto' }} onClick={() => goFiltered('/alerts')}>アラート設定へ</button>
              </div>
              <div className="c-body">
                {d.alerts.length === 0 ? (
                  <p style={{ margin: 0, color: 'var(--good)', fontWeight: 600 }}>✓ 対応が必要なアラートはありません。</p>
                ) : (
                  <div className="proj-alerts">
                    {d.alerts.map((e) => (
                      <div key={e.id} className={`proj-alert ${e.severity}`}>
                        <div className="pa-title">{e.title}</div>
                        <div className="pa-body">{e.accountName}: {e.body.replace(`${e.accountName}: `, '')}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {/* --- 改善 --- */}
          {tab === 'improve' ? (
            <div className="card">
              <div className="c-head"><h2>改善する</h2></div>
              <div className="c-body form-grid">
                <p style={{ margin: 0, fontSize: 14, color: 'var(--ink-2)' }}>
                  未対応の改善提案は <b className="num" style={{ color: d.openFindings > 0 ? 'var(--warn)' : 'var(--good)' }}>{d.openFindings}件</b> です。
                  下のボタンから、このプロジェクトの改善作業に進めます。
                </p>
                <div className="proj-actions">
                  <button className="btn pri" onClick={() => goFiltered('/audit')}>🩺 AI診断で改善点を見る</button>
                  <button className="btn sec" onClick={() => goFiltered('/keywords')}>🔍 キーワード最適化</button>
                  <button className="btn sec" onClick={() => goFiltered('/approvals')}>✅ 承認キュー</button>
                  <button className="btn sec" onClick={() => goFiltered('/report')}>📄 レポートを作成</button>
                </div>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </>
  );
}
