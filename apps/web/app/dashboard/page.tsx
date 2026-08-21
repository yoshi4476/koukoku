'use client';

import { Fragment, useEffect, useState } from 'react';
import Link from 'next/link';
import type { CampaignBreakdownDto, DailyPointDto, DashboardDto, Platform } from '@adgrid/shared';
import { ALL_PLATFORMS } from '@adgrid/shared';
import { useApi } from '@/components/use-api';
import { useClients } from '@/components/client-context';
import { TrendChart } from '@/components/trend-chart';
import { DeltaPill, DeltaText, ErrorCard, PlatformTag, Skeleton, SkeletonLines } from '@/components/ui';
import { PLATFORM_SHORT_LABEL } from '@/lib/labels';
import { formatNumber, formatPercent, formatPeriod, formatYen } from '@/lib/format';

function Sparkline({ values, stroke }: { values: number[]; stroke: string }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const pts = values
    .map((v, i) => `${(72 * i) / (values.length - 1)},${21 - ((v - min) / range) * 18}`)
    .join(' ');
  const lastX = 72;
  const lastVal = values[values.length - 1] ?? 0;
  const lastY = 21 - ((lastVal - min) / range) * 18;
  return (
    <svg className="spark" width="72" height="24" viewBox="0 0 72 24" aria-hidden="true">
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" />
      <circle cx={lastX} cy={lastY} r="2.5" fill={stroke} />
    </svg>
  );
}

interface KpiDef {
  label: string;
  value: string;
  unit?: string;
  delta: number | null;
  /** CPA は低いほど良い */
  invert?: boolean;
  spark: number[];
}

function dailyCpa(points: DailyPointDto[]): number[] {
  return points.map((p) => (p.conversions > 0 ? p.cost / p.conversions : 0));
}

function KpiCards({ data }: { data: DashboardDto }) {
  const { kpi, trend } = data;
  const defs: KpiDef[] = [
    { label: '消化額', value: formatYen(kpi.cost), delta: kpi.deltas.cost, spark: trend.current.map((p) => p.cost) },
    { label: 'CV', value: formatNumber(kpi.conversions), unit: ' 件', delta: kpi.deltas.conversions, spark: trend.current.map((p) => p.conversions) },
    { label: 'CPA', value: formatYen(kpi.cpa), delta: kpi.deltas.cpa, invert: true, spark: dailyCpa(trend.current) },
    { label: 'ROAS', value: kpi.roas === null ? '—' : formatNumber(kpi.roas), unit: kpi.roas === null ? undefined : ' %', delta: kpi.deltas.roas, spark: [] },
  ];
  return (
    <div className="kpis">
      {defs.map((d) => {
        const worsened =
          d.delta !== null && Math.abs(d.delta) >= 1 && (d.invert ? d.delta > 0 : d.delta < 0);
        return (
          <div className="kpi" key={d.label}>
            <div className="k-label">{d.label} (直近7日)</div>
            <div className="k-val num">
              {d.value}
              {d.unit ? <span className="k-unit">{d.unit}</span> : null}
            </div>
            <div className="k-foot">
              <DeltaPill value={d.delta} invert={d.invert ?? false} />
              <Sparkline values={d.spark} stroke={worsened ? 'var(--bad)' : 'var(--primary)'} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <>
      <div className="kpis">
        {Array.from({ length: 4 }, (_, i) => (
          <div className="kpi" key={i}>
            <Skeleton w="40%" h={12} style={{ marginBottom: 10 }} />
            <Skeleton w="70%" h={26} style={{ marginBottom: 10 }} />
            <Skeleton w="55%" h={16} />
          </div>
        ))}
      </div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="c-body">
          <Skeleton w="100%" h={180} />
        </div>
      </div>
      <div className="card">
        <div className="c-body">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} w="100%" h={20} style={{ marginBottom: 10 }} />
          ))}
        </div>
      </div>
    </>
  );
}

export default function DashboardPage() {
  const { selectedClientId } = useClients();
  const [platform, setPlatform] = useState<'' | Platform>('');
  // 媒体別表の行クリックで展開するキャンペーンドリルダウン (null = 閉じている)
  const [expanded, setExpanded] = useState<Platform | null>(null);

  // 媒体タブ・クライアント切替時は展開状態をリセットする
  useEffect(() => {
    setExpanded(null);
  }, [platform, selectedClientId]);

  const params = new URLSearchParams({ days: '7' });
  if (selectedClientId) params.set('clientId', selectedClientId);
  if (platform) params.set('platform', platform);
  const { data, loading, error, retry } = useApi<DashboardDto>(`/dashboard?${params.toString()}`);

  const campaignParams = new URLSearchParams({ days: '7' });
  if (selectedClientId) campaignParams.set('clientId', selectedClientId);
  if (expanded) campaignParams.set('platform', expanded);
  const campaigns = useApi<CampaignBreakdownDto[]>(
    expanded ? `/dashboard/campaigns?${campaignParams.toString()}` : null,
  );

  const hasData = data !== null && (data.kpi.impressions > 0 || data.kpi.cost > 0 || data.byPlatform.length > 0);

  return (
    <>
      <div className="page-h">
        <h1>統合ダッシュボード</h1>
        {data ? <span className="sub">期間: {formatPeriod(data.period.since, data.period.until)} · 比較: 前週</span> : null}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div className="tabs" role="tablist" aria-label="媒体で絞り込む">
          <button type="button" role="tab" className={`tab${platform === '' ? ' on' : ''}`} aria-selected={platform === ''} onClick={() => setPlatform('')}>
            すべて
          </button>
          {ALL_PLATFORMS.map((p) => (
            <button
              key={p}
              type="button"
              role="tab"
              className={`tab${platform === p ? ' on' : ''}`}
              aria-selected={platform === p}
              onClick={() => setPlatform(p)}
            >
              {PLATFORM_SHORT_LABEL[p]}
            </button>
          ))}
        </div>
      </div>

      {error ? <ErrorCard error={error} onRetry={retry} /> : null}
      {loading ? <DashboardSkeleton /> : null}

      {data && !hasData ? (
        <div className="empty">
          <div className="e-title">まだ実績データがありません</div>
          <div className="e-sub">CSVを取り込むか、API接続 (Phase 2) を設定するとダッシュボードに実績が表示されます。</div>
          <Link href="/import" className="btn pri">CSVを取り込む</Link>
        </div>
      ) : null}

      {data && hasData ? (
        <>
          <KpiCards data={data} />

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="c-head">
              <h2>日次消化額 — 今期 vs 前週</h2>
              <span className="legend">
                <span className="li"><span className="ln" />今期</span>
                <span className="li"><span className="ln prev" />前週</span>
              </span>
            </div>
            <div className="c-body">
              <TrendChart current={data.trend.current} previous={data.trend.previous} />
            </div>
          </div>

          <div className="card">
            <div className="c-head">
              <h2>媒体別ブレイクダウン</h2>
              <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--muted)' }}>行クリックでキャンペーン別に展開 · 前週比はCPA基準 (▼=良化)</span>
            </div>
            <div className="c-body tbl-scroll" style={{ padding: 0 }}>
              {data.byPlatform.length === 0 ? (
                <p style={{ padding: '14px 16px', margin: 0, color: 'var(--muted)' }}>この条件に該当する媒体データがありません。</p>
              ) : (
                <table className="data-tbl">
                  <thead>
                    <tr>
                      <th>媒体</th>
                      <th>消化額</th>
                      <th>Imp</th>
                      <th>Click</th>
                      <th>CTR</th>
                      <th>CVR</th>
                      <th>CV</th>
                      <th>CPA</th>
                      <th>ROAS</th>
                      <th>前週比 (CPA)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byPlatform.map((row) => (
                      <Fragment key={row.platform}>
                        <tr
                          className="drill-row"
                          aria-expanded={expanded === row.platform}
                          title={expanded === row.platform ? 'クリックで閉じる' : 'クリックでキャンペーン別に展開'}
                          onClick={() => setExpanded((p) => (p === row.platform ? null : row.platform))}
                        >
                          <td><PlatformTag platform={row.platform} /></td>
                          <td>{formatYen(row.cost)}</td>
                          <td>{formatNumber(row.impressions)}</td>
                          <td>{formatNumber(row.clicks)}</td>
                          <td>{formatPercent(row.ctr, 2)}</td>
                          <td>{formatPercent(row.cvr, 2)}</td>
                          <td>{formatNumber(row.conversions)}</td>
                          <td>{formatYen(row.cpa)}</td>
                          <td>{row.roas === null ? '—' : `${Math.round(row.roas)}%`}</td>
                          <td><DeltaText value={row.cpaDelta} invert /></td>
                        </tr>
                        {expanded === row.platform ? (
                          <tr>
                            <td className="drill-cell" colSpan={10}>
                              {campaigns.loading ? (
                                <div style={{ padding: '12px 16px' }}>
                                  <SkeletonLines count={3} />
                                </div>
                              ) : campaigns.error ? (
                                <div style={{ padding: '12px 16px' }}>
                                  <ErrorCard error={campaigns.error} onRetry={campaigns.retry} />
                                </div>
                              ) : (campaigns.data ?? []).length === 0 ? (
                                <p style={{ padding: '12px 16px', margin: 0, color: 'var(--muted)', fontSize: 12.5 }}>
                                  この媒体のキャンペーンデータがありません。
                                </p>
                              ) : (
                                <table className="data-tbl">
                                  <thead>
                                    <tr>
                                      <th>キャンペーン</th>
                                      <th>消化額</th>
                                      <th>Imp</th>
                                      <th>Click</th>
                                      <th>CTR</th>
                                      <th>CV</th>
                                      <th>CPA</th>
                                      <th>ROAS</th>
                                      <th>前週比 (CPA)</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {(campaigns.data ?? []).map((c) => (
                                      <tr key={c.campaignId}>
                                        <td>{c.campaignName}</td>
                                        <td>{formatYen(c.cost)}</td>
                                        <td>{formatNumber(c.impressions)}</td>
                                        <td>{formatNumber(c.clicks)}</td>
                                        <td>{formatPercent(c.ctr, 2)}</td>
                                        <td>{formatNumber(c.conversions)}</td>
                                        <td>{formatYen(c.cpa)}</td>
                                        <td>{c.roas === null ? '—' : `${Math.round(c.roas)}%`}</td>
                                        <td><DeltaText value={c.cpaDelta} invert /></td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}
