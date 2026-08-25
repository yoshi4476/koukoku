'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { PacingDto, PacingSweepDto } from '@adgrid/shared';
import { useApi } from '@/components/use-api';
import { EmptyState, ErrorCard, HintBar, PlatformTag, SkeletonLines } from '@/components/ui';
import { apiPost, ApiError, toApiError } from '@/lib/api';
import { formatDate, formatPercent, formatYen } from '@/lib/format';

const STATUS_META: Record<PacingDto['status'], { pill: string; label: string; seg: string }> = {
  over: { pill: 'down', label: '超過ペース', seg: 'over' },
  under: { pill: 'warn', label: '未消化', seg: 'under' },
  on_track: { pill: 'up', label: '順調', seg: 'on' },
};

/* ---- 消化・着地予測を月予算(100%)基準で重ねて表示 ---- */
function PaceBar({ p }: { p: PacingDto }) {
  const spentPct = p.monthlyBudget > 0 ? (p.monthToDateCost / p.monthlyBudget) * 100 : 0;
  const projPct = p.projectedPct;
  // 100%ラインが見えるよう、着地予測が予算を超える場合はその分だけ目盛を広げる
  const scaleMax = Math.max(110, projPct + 8);
  const budgetLine = (100 / scaleMax) * 100;
  const seg = STATUS_META[p.status].seg;
  return (
    <div className="pace-viz">
      <div className="pace-row">
        <span className="pace-tag">当月消化</span>
        <div className="pace-track">
          <div className="pace-seg spent" style={{ width: `${Math.min((spentPct / scaleMax) * 100, 100)}%` }} />
          <div className="pace-100" style={{ left: `${budgetLine}%` }} />
        </div>
        <span className="pace-pct num">{formatPercent(spentPct, 0)}</span>
      </div>
      <div className="pace-row">
        <span className="pace-tag">着地予測</span>
        <div className="pace-track">
          <div className={`pace-seg proj ${seg}`} style={{ width: `${Math.min((projPct / scaleMax) * 100, 100)}%` }} />
          <div className="pace-100" style={{ left: `${budgetLine}%` }} />
        </div>
        <span className="pace-pct num">{formatPercent(projPct, 0)}</span>
      </div>
      <div className="pace-legend">縦線 = 月予算 (100%)</div>
    </div>
  );
}

function PaceCard({ p }: { p: PacingDto }) {
  const meta = STATUS_META[p.status];
  return (
    <div className="pace-card">
      <div className="pace-head">
        <span className="pace-name">{p.accountName}</span>
        <span className={`pill ${meta.pill}`}>{meta.label}</span>
        <PlatformTag platform={p.platform} />
        <span className="pace-client">{p.clientName}</span>
      </div>

      <div className="pace-figs">
        <div className="pace-fig">
          <div className="pf-label">月予算</div>
          <div className="pf-val num">{formatYen(p.monthlyBudget)}</div>
        </div>
        <div className="pace-fig">
          <div className="pf-label">当月消化</div>
          <div className="pf-val num">{formatYen(p.monthToDateCost)}</div>
        </div>
        <div className="pace-fig">
          <div className="pf-label">着地予測</div>
          <div className="pf-val num">
            {formatYen(p.projectedMonthEnd)}
            <span className={`pill ${meta.pill}`} style={{ marginLeft: 6 }}>{formatPercent(p.projectedPct, 0)}</span>
          </div>
        </div>
      </div>

      <PaceBar p={p} />

      <div className="pace-figs sub">
        <div className="pace-fig">
          <div className="pf-label">推奨日予算</div>
          <div className="pf-val sm num">{formatYen(p.recommendedDailyBudget)}</div>
        </div>
        <div className="pace-fig">
          <div className="pf-label">現在の日平均</div>
          <div className="pf-val sm num">{formatYen(p.currentDailyAvg)}</div>
        </div>
        <div className="pace-fig">
          <div className="pf-label">残日数</div>
          <div className="pf-val sm num">{p.daysLeft}日</div>
        </div>
      </div>

      {p.runOutDate ? (
        <div className="pace-runout">このままだと {formatDate(p.runOutDate)} に予算到達</div>
      ) : null}

      {p.status === 'over' ? (
        <div className="f-actions">
          <Link className="btn sm pri" href={`/audit?accountId=${encodeURIComponent(p.adAccountId)}`}>
            予算調整を申請
          </Link>
        </div>
      ) : null}
    </div>
  );
}

/** 予算逸脱アカウントを承認キューへ一括提案する自動反映ループの起点 (F-51) */
function AutoProposeBar({ deviating }: { deviating: number }) {
  const [state, setState] = useState<'idle' | 'running'>('idle');
  const [result, setResult] = useState<PacingSweepDto | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const run = () => {
    setState('running');
    setError(null);
    apiPost<PacingSweepDto>('/pacing/propose', {})
      .then((r) => { setResult(r); setState('idle'); })
      .catch((e: unknown) => { setError(toApiError(e)); setState('idle'); });
  };

  return (
    <div className="autoprop">
      <div className="autoprop-row">
        <div className="autoprop-txt">
          <b>自動反映ループ</b>
          <span>予算逸脱アカウントを検出し、予算調整の提案を承認キューに下書きします。適用は承認が必要です。</span>
        </div>
        <button type="button" className="btn sm pri" onClick={run} disabled={state === 'running' || deviating === 0}>
          {state === 'running' ? '作成中…' : `予算提案を作成${deviating > 0 ? ` (${deviating}件対象)` : ''}`}
        </button>
      </div>
      {error ? <ErrorCard error={error} onRetry={run} /> : null}
      {result ? (
        <div className={`autoprop-result ${result.created > 0 ? 'ok' : 'flat'}`}>
          {result.created > 0 ? (
            <>
              <span>{result.created}件の予算提案を承認キューに作成しました{result.skipped > 0 ? `（${result.skipped}件は保留中のためスキップ）` : ''}。</span>
              <Link href="/approvals" className="btn sm sec">承認キューを開く →</Link>
            </>
          ) : result.scanned > 0 ? (
            <span>対象{result.scanned}件はすでに保留中の提案があるため、新規作成はありませんでした。</span>
          ) : (
            <span>提案が必要な予算逸脱は見つかりませんでした。</span>
          )}
        </div>
      ) : null}
    </div>
  );
}

export default function PacingPage() {
  const pacing = useApi<PacingDto[]>('/pacing');
  const list = pacing.data ?? [];
  const overCount = list.filter((p) => p.status === 'over').length;
  const underCount = list.filter((p) => p.status === 'under').length;
  const onTrackCount = list.filter((p) => p.status === 'on_track').length;
  const deviating = overCount + underCount;

  return (
    <>
      <div className="page-h">
        <h1>予算ペース</h1>
        <span className="sub">月予算に対する消化ペースと着地予測を確認します</span>
      </div>

      <HintBar id="pacing" title="予算ペースの使い方">
        月予算に対する<mark>着地予測</mark>を表示します。青=当月消化・オレンジ=着地予測のバーで、100%ラインを超えると予算オーバー。<mark>推奨日予算</mark>に調整すれば予算内に収まります。超過ペースのアカウントは早めに対応を。
      </HintBar>

      {pacing.error ? <ErrorCard error={pacing.error} onRetry={pacing.retry} /> : null}

      {pacing.loading ? (
        <div className="card">
          <div className="c-body"><SkeletonLines count={5} /></div>
        </div>
      ) : null}

      {list.length > 0 ? (
        <>
          <AutoProposeBar deviating={deviating} />
          <div className="pace-summary">
            <span className="pill down">超過 {overCount}件</span>
            <span className="pill warn">未消化 {underCount}件</span>
            <span className="pill up">順調 {onTrackCount}件</span>
          </div>
          <div className="pace-list">
            {list.map((p) => (
              <PaceCard key={p.adAccountId} p={p} />
            ))}
          </div>
        </>
      ) : null}

      {pacing.data && list.length === 0 ? (
        <EmptyState
          title="月予算が設定されたアカウントがありません"
          sub="クライアント画面でアカウントに月予算を設定すると、着地予測がここに表示されます。"
          action={<Link href="/clients" className="btn pri">クライアント画面へ</Link>}
        />
      ) : null}
    </>
  );
}
