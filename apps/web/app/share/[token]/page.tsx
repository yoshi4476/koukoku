'use client';

import { use } from 'react';
import type { PublicPortalDto } from '@adgrid/shared';
import { useApi } from '@/components/use-api';
import { ErrorCard, SkeletonLines } from '@/components/ui';
import { formatNumber, formatYen } from '@/lib/format';

function MiniTrend({ points }: { points: PublicPortalDto['trend'] }) {
  if (points.length < 2) return null;
  const w = 900, h = 120, pad = 6;
  const max = Math.max(...points.map((p) => p.cost), 1);
  const step = (w - pad * 2) / (points.length - 1);
  const y = (v: number) => h - pad - (v / max) * (h - pad * 2);
  const line = points.map((p, i) => `${pad + i * step},${y(p.cost)}`).join(' ');
  const area = `${pad},${h - pad} ${line} ${pad + (points.length - 1) * step},${h - pad}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none" role="img" aria-label="消化額の推移">
      <polygon points={area} fill="var(--primary-soft)" />
      <polyline points={line} fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

export default function SharePortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const { data, loading, error, retry } = useApi<PublicPortalDto>(`/share/${token}`);

  return (
    <div className="portal-wrap">
      <div className="portal-inner">
        <div className="portal-brand">AD<span className="bx">GRID</span> <span className="portal-tag">成果レポート（閲覧専用）</span></div>

        {loading ? <div className="card"><div className="c-body"><SkeletonLines count={5} /></div></div> : null}
        {error ? <ErrorCard error={error} onRetry={retry} /> : null}

        {data ? (
          <>
            <div className="page-h" style={{ marginTop: 8 }}>
              <h1>{data.clientName}</h1>
              <span className="sub">{data.industryLabel}・{data.periodLabel}</span>
            </div>

            <div className="kpis" style={{ marginBottom: 14 }}>
              <div className="kpi"><div className="k-label">消化額 (30日)</div><div className="k-val">{formatYen(data.kpi.cost)}</div></div>
              <div className="kpi"><div className="k-label">CV</div><div className="k-val">{formatNumber(data.kpi.conversions)}</div></div>
              <div className="kpi"><div className="k-label">CPA</div><div className="k-val">{formatYen(data.kpi.cpa)}</div></div>
              <div className="kpi"><div className="k-label">ROAS</div><div className="k-val">{data.kpi.roas === null ? '—' : `${data.kpi.roas}%`}</div></div>
            </div>

            <div className="card" style={{ marginBottom: 14 }}>
              <div className="c-head"><h2>消化額の推移（直近30日）</h2></div>
              <div className="c-body"><MiniTrend points={data.trend} /></div>
            </div>

            <div className="card">
              <div className="c-head"><h2>施策（プロジェクト）別の成果</h2></div>
              <div className="c-body tbl-scroll" style={{ padding: 0 }}>
                <table className="data-tbl">
                  <thead><tr><th>プロジェクト</th><th>消化額</th><th>CV</th><th>CPA</th></tr></thead>
                  <tbody>
                    {data.projects.map((p) => (
                      <tr key={p.name}><td>{p.name}</td><td>{formatYen(p.cost)}</td><td>{formatNumber(p.conversions)}</td><td>{formatYen(p.cpa)}</td></tr>
                    ))}
                    {data.projects.length === 0 ? <tr><td colSpan={4} style={{ color: 'var(--muted)' }}>データがありません。</td></tr> : null}
                  </tbody>
                </table>
              </div>
            </div>

            <p className="portal-foot">ADGRID による自動生成レポートです。数値は配信データに基づきます。閲覧専用のため操作はできません。</p>
          </>
        ) : null}
      </div>
    </div>
  );
}
