'use client';

import Link from 'next/link';
import type { ProjectDto } from '@adgrid/shared';
import { SEASON_EVENTS } from '@adgrid/shared';
import { useApi } from '@/components/use-api';
import { ErrorCard, HintBar, SkeletonLines } from '@/components/ui';
import { formatYen } from '@/lib/format';

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const WEIGHT_CLS = ['', 'w1', 'w2', 'w3'];

/** ISO(YYYY-MM-DD)から今年基準の月インデックス(0-11)。範囲外はクランプ */
function monthIndex(iso: string | null, fallback: number): number {
  if (!iso) return fallback;
  const m = Number(iso.slice(5, 7));
  return Number.isNaN(m) ? fallback : Math.min(11, Math.max(0, m - 1));
}

function pacing(p: ProjectDto): { label: string; cls: string } | null {
  if (!p.monthlyBudget || p.monthlyBudget <= 0) return null;
  const monthlyPace = Math.round((p.cost7d / 7) * 30);
  const pct = Math.round((monthlyPace / p.monthlyBudget) * 100);
  if (pct > 115) return { label: `消化オーバー ${pct}%`, cls: 'down' };
  if (pct < 70) return { label: `消化不足 ${pct}%`, cls: 'warn' };
  return { label: `適正 ${pct}%`, cls: 'up' };
}

export default function CalendarPage() {
  const { data, loading, error, retry } = useApi<ProjectDto[]>('/projects');
  const nowMonth = (() => { try { return new Date().getMonth(); } catch { return 0; } })();

  return (
    <>
      <div className="page-h"><h1>📅 キャンペーンカレンダー</h1></div>
      <HintBar id="calendar" title="キャンペーンカレンダーの使い方">
        <mark>需要期(季節イベント)</mark>と各プロジェクトの<mark>配信期間・予算ペース</mark>を1画面で俯瞰します。需要期の前に予算を厚くし、配信期間の重なりや消化の過不足を早めに調整しましょう。
      </HintBar>

      {/* 需要カレンダー */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="c-head"><h2>需要カレンダー（日本の販促イベント）</h2></div>
        <div className="c-body">
          <div className="cal-grid">
            {MONTHS.map((m) => (
              <div key={m} className={`cal-month${m - 1 === nowMonth ? ' now' : ''}`}>
                <div className="cal-mh">{m}月{m - 1 === nowMonth ? ' ●' : ''}</div>
                {SEASON_EVENTS.filter((e) => e.month === m).map((e) => (
                  <div key={e.name} className={`cal-ev ${WEIGHT_CLS[e.weight]}`} title={e.note}>{e.name}</div>
                ))}
              </div>
            ))}
          </div>
          <div className="cal-legend"><span className="cal-ev w3">大</span><span className="cal-ev w2">中</span><span className="cal-ev w1">小</span> 需要の強さ</div>
        </div>
      </div>

      {/* プロジェクトの配信タイムライン */}
      <div className="card">
        <div className="c-head"><h2>配信タイムラインと予算ペース</h2></div>
        <div className="c-body">
          {loading ? <SkeletonLines count={4} /> : null}
          {error ? <ErrorCard error={error} onRetry={retry} /> : null}
          {data && data.length === 0 ? <p style={{ margin: 0, color: 'var(--muted)' }}>プロジェクトがありません。</p> : null}
          {data && data.length > 0 ? (
            <div className="tl">
              <div className="tl-axis"><div className="tl-name" /><div className="tl-months">{MONTHS.map((m) => <div key={m} className="tl-mcell">{m}月</div>)}</div><div /></div>
              {data.map((p) => {
                const s = monthIndex(p.startDate, 0);
                const e = Math.max(s, monthIndex(p.endDate, 11));
                const pace = pacing(p);
                return (
                  <div key={p.id} className="tl-row">
                    <div className="tl-name">
                      <Link href={`/projects/${p.id}`} className="tl-link">{p.name}</Link>
                      <span className="tl-client">{p.clientName}</span>
                    </div>
                    <div className="tl-track">
                      <div className={`tl-bar ${p.status}`} style={{ left: `${(s / 12) * 100}%`, width: `${((e - s + 1) / 12) * 100}%` }}>
                        {p.monthlyBudget ? formatYen(p.monthlyBudget) + '/月' : '配信中'}
                      </div>
                    </div>
                    <div className="tl-pace">{pace ? <span className={`pill ${pace.cls}`}>{pace.label}</span> : <span className="tl-nobudget">予算未設定</span>}</div>
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}
