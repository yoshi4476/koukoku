'use client';

import { Fragment, useMemo, useState } from 'react';
import Link from 'next/link';
import type { KeywordAction, KeywordOptimizeDto, KeywordRankItemDto, KeywordRowDto, ProposalDto } from '@adgrid/shared';
import { isApprover } from '@adgrid/shared';
import { useApi } from '@/components/use-api';
import { useAuth } from '@/components/auth-context';
import { useClients } from '@/components/client-context';
import { EmptyState, ErrorCard, HintBar, PlatformTag, SkeletonLines } from '@/components/ui';
import { apiPost, ApiError, toApiError } from '@/lib/api';
import { KEYWORD_ACTION_META, MATCH_TYPE_LABEL } from '@/lib/labels';
import { formatNumber, formatPercent, formatYen } from '@/lib/format';

type ActionFilter = 'all' | KeywordAction;

const FILTER_TABS: { key: ActionFilter; label: string }[] = [
  { key: 'all', label: 'すべて' },
  { key: 'increase', label: '増額' },
  { key: 'keep', label: '維持' },
  { key: 'decrease', label: '減額' },
  { key: 'pause', label: '停止' },
];

function ActionPill({ action }: { action: KeywordAction }) {
  const m = KEYWORD_ACTION_META[action];
  return (
    <span className={`pill ${m.cls}`}>
      <span aria-hidden>{m.icon}</span> {m.label}
    </span>
  );
}

/* ---- 算出ランキング (最高CTR / バランス最良 / 最高ROI) ---- */
function RankCard({
  title,
  hint,
  accent,
  items,
  fmt,
}: {
  title: string;
  hint: string;
  accent: string;
  items: KeywordRankItemDto[];
  fmt: (v: number) => string;
}) {
  return (
    <div className="kw-rank" style={{ ['--rank-accent' as string]: accent }}>
      <div className="kw-rank-h">
        <span className="kw-rank-title">{title}</span>
        <span className="kw-rank-hint">{hint}</span>
      </div>
      {items.length === 0 ? (
        <p className="kw-rank-empty">対象データがまだありません</p>
      ) : (
        <ol className="kw-rank-list">
          {items.map((it, i) => (
            <li key={`${it.keyword}-${i}`}>
              <span className="kw-rank-no">{i + 1}</span>
              <span className="kw-rank-body">
                <span className="kw-rank-kw">{it.keyword}</span>
                <span className="kw-rank-note">{it.note}</span>
              </span>
              <span className="kw-rank-val num">{fmt(it.metricValue)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function ProposeAction({ r }: { r: KeywordRowDto }) {
  const { me } = useAuth();
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle');
  const [error, setError] = useState<ApiError | null>(null);

  // 提供先版・維持推奨・承認権限なしでは申請導線を出さない
  if (me.edition === 'client' || r.action === 'keep' || !isApprover(me.role)) return null;

  const actionLabel = r.action === 'increase' ? '増額' : r.action === 'decrease' ? '減額' : '停止';
  const submit = () => {
    setState('sending');
    setError(null);
    apiPost<ProposalDto>(`/keywords/${r.id}/propose`, {})
      .then(() => setState('done'))
      .catch((e: unknown) => {
        setError(toApiError(e));
        setState('idle');
      });
  };

  return (
    <div className="kw-propose">
      {state === 'done' ? (
        <span className="kw-propose-done">
          ✓ 承認キューに{actionLabel}提案を起票しました
          <Link href="/approvals" className="btn sm sec" style={{ marginLeft: 8 }}>承認キューを開く</Link>
        </span>
      ) : (
        <button type="button" className="btn sm pri" disabled={state === 'sending'} onClick={submit}>
          {state === 'sending' ? '申請中…' : `この${actionLabel}を承認申請`}
        </button>
      )}
      {error ? <span className="kw-propose-err">{error.message}</span> : null}
    </div>
  );
}

function RowDetail({ r }: { r: KeywordRowDto }) {
  return (
    <div className="kw-detail">
      <div className="kw-detail-texts">
        <div className="kw-detail-block">
          <div className="kw-detail-label">推奨理由</div>
          <div className="kw-detail-text">{r.reason}</div>
        </div>
        <div className="kw-detail-block">
          <div className="kw-detail-label">期待効果</div>
          <div className="kw-detail-text">{r.expectedImpact}</div>
        </div>
      </div>
      <div className="kw-detail-figs">
        <div className="kw-detail-fig">
          <div className="kw-detail-label">現在入札</div>
          <div className="num">{r.currentBid === null ? '—' : formatYen(r.currentBid)}</div>
        </div>
        <div className="kw-detail-fig">
          <div className="kw-detail-label">推奨入札</div>
          <div className="num">
            {r.action === 'pause'
              ? '停止'
              : r.recommendedBid === null
                ? '—'
                : formatYen(r.recommendedBid)}
            {r.bidChangePct !== 0 ? (
              <span className={`pill ${r.bidChangePct > 0 ? 'up' : 'warn'}`} style={{ marginLeft: 6 }}>
                {r.bidChangePct > 0 ? '+' : ''}
                {r.bidChangePct}%
              </span>
            ) : null}
          </div>
        </div>
        <div className="kw-detail-fig">
          <div className="kw-detail-label">品質スコア</div>
          <div className="num">{r.qualityScore === null ? '—' : `${r.qualityScore}/10`}</div>
        </div>
        <div className="kw-detail-fig">
          <div className="kw-detail-label">CPC</div>
          <div className="num">{formatYen(r.cpc)}</div>
        </div>
      </div>
      <ProposeAction r={r} />
    </div>
  );
}

export default function KeywordsPage() {
  const { selectedClientId } = useClients();
  const path = `/keywords/optimize${selectedClientId ? `?clientId=${encodeURIComponent(selectedClientId)}` : ''}`;
  const opt = useApi<KeywordOptimizeDto>(path);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<ActionFilter>('all');
  const [expanded, setExpanded] = useState<string | null>(null);

  const data = opt.data;
  const allRows = data?.rows ?? [];

  const counts = useMemo(() => {
    const c: Record<ActionFilter, number> = { all: allRows.length, increase: 0, keep: 0, decrease: 0, pause: 0 };
    for (const r of allRows) c[r.action]++;
    return c;
  }, [allRows]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return allRows.filter(
      (r) => (filter === 'all' || r.action === filter) && (!needle || r.keyword.toLowerCase().includes(needle)),
    );
  }, [allRows, q, filter]);

  return (
    <>
      <div className="page-h">
        <h1>キーワード最適化</h1>
        <span className="sub">キーワード単位で増額・減額・停止を自動判定し、効率の良いキーワードを算出します</span>
      </div>

      <HintBar id="keywords" title="キーワード最適化の使い方">
        検索窓に<mark>キーワードを入れるだけ</mark>で、そのキーワードの指標と推奨がわかります。各行は業種相場と比べて
        <mark>増額（伸ばすべき）</mark>・<mark>減額</mark>・<mark>停止（費用の無駄）</mark>を自動判定。上部の
        <mark>最高CTR・バランス最良・最高ROI</mark>ランキングで「どこに寄せるべきか」が一目でわかります。行をクリックすると推奨理由と推奨入札額が開きます。
      </HintBar>

      {opt.error ? <ErrorCard error={opt.error} onRetry={opt.retry} /> : null}

      {opt.loading ? (
        <div className="card">
          <div className="c-body">
            <SkeletonLines count={6} />
          </div>
        </div>
      ) : null}

      {data && allRows.length === 0 ? (
        <EmptyState
          title="キーワードデータがありません"
          sub="検索広告（Google / Yahoo!）を接続・同期すると、キーワード単位の最適化がここに表示されます。"
          action={
            <Link href="/connections" className="btn pri">
              媒体を接続する
            </Link>
          }
        />
      ) : null}

      {data && allRows.length > 0 ? (
        <>
          {/* 算出ランキング */}
          <div className="kw-ranks">
            <RankCard
              title="最高クリック率"
              hint="表示に対し最も反応が良い"
              accent="var(--primary)"
              items={data.topCtr}
              fmt={(v) => `${v}%`}
            />
            <RankCard
              title="バランス最良"
              hint="CTR・費用・ROIの総合効率"
              accent="var(--good)"
              items={data.bestBalance}
              fmt={(v) => `${v}点`}
            />
            <RankCard
              title="最高ROI"
              hint="投資対効果が最も高い"
              accent="#a855f7"
              items={data.topRoi}
              fmt={(v) => `${v}%`}
            />
          </div>

          {/* 予算再配分サマリ */}
          <div className="kw-summary">
            <div className="kw-sum-item">
              <span className="kw-sum-label">増額推奨</span>
              <span className="kw-sum-val up num">{data.summary.increaseCount}件</span>
            </div>
            <div className="kw-sum-item">
              <span className="kw-sum-label">減額推奨</span>
              <span className="kw-sum-val warn num">{data.summary.decreaseCount}件</span>
            </div>
            <div className="kw-sum-item">
              <span className="kw-sum-label">停止推奨</span>
              <span className="kw-sum-val down num">{data.summary.pauseCount}件</span>
            </div>
            <div className="kw-sum-item wide">
              <span className="kw-sum-label">減額・停止で回収できる予算</span>
              <span className="kw-sum-val num">{formatYen(data.summary.reclaimableBudget)}/月</span>
            </div>
            <div className="kw-sum-item wide">
              <span className="kw-sum-label">増額へ再配分した場合のCV増</span>
              <span className="kw-sum-val up num">+{data.summary.projectedCvGain}件/月</span>
            </div>
          </div>

          {/* 操作バー */}
          <div className="kw-toolbar">
            <input
              className="input kw-search"
              type="search"
              placeholder="キーワードを入力して絞り込み…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <div className="tabs">
              {FILTER_TABS.map((t) => (
                <button
                  key={t.key}
                  className={`tab ${filter === t.key ? 'on' : ''}`}
                  onClick={() => setFilter(t.key)}
                >
                  {t.label} <span className="wtab-count">{counts[t.key]}</span>
                </button>
              ))}
            </div>
            <span className="kw-industry">相場基準: {data.industryLabel}・直近{data.windowDays}日</span>
          </div>

          {/* キーワード表 */}
          <div className="card">
            <div className="c-body tbl-scroll" style={{ padding: 0 }}>
              {rows.length === 0 ? (
                <p style={{ padding: '14px 16px', margin: 0, color: 'var(--muted)' }}>
                  条件に一致するキーワードがありません。
                </p>
              ) : (
                <table className="data-tbl kw-tbl">
                  <thead>
                    <tr>
                      <th>推奨</th>
                      <th>キーワード</th>
                      <th>表示</th>
                      <th>Click</th>
                      <th>CTR</th>
                      <th>費用</th>
                      <th>CV</th>
                      <th>CPA</th>
                      <th>ROAS</th>
                      <th>効率</th>
                      <th>増減</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <Fragment key={r.id}>
                        <tr
                          className="drill-row"
                          aria-expanded={expanded === r.id}
                          title={expanded === r.id ? 'クリックで閉じる' : 'クリックで推奨理由を表示'}
                          onClick={() => setExpanded((p) => (p === r.id ? null : r.id))}
                        >
                          <td>
                            <ActionPill action={r.action} />
                          </td>
                          <td>
                            <div className="kw-cell">
                              <span className="kw-name">{r.keyword}</span>
                              <span className="kw-meta">
                                <PlatformTag platform={r.platform} />
                                <span className="kw-match">{MATCH_TYPE_LABEL[r.matchType] ?? r.matchType}</span>
                                <span className="kw-client">{r.clientName}</span>
                              </span>
                            </div>
                          </td>
                          <td>{formatNumber(r.impressions)}</td>
                          <td>{formatNumber(r.clicks)}</td>
                          <td>{formatPercent(r.ctr, 2)}</td>
                          <td>{formatYen(r.cost)}</td>
                          <td>{formatNumber(r.conversions)}</td>
                          <td>{formatYen(r.cpa)}</td>
                          <td>{r.roas === null ? '—' : `${r.roas}%`}</td>
                          <td>
                            <span className="kw-eff">
                              <span className="kw-eff-bar" style={{ width: `${r.efficiency}%` }} />
                              <span className="kw-eff-num num">{r.efficiency}</span>
                            </span>
                          </td>
                          <td>
                            {r.bidChangePct === 0 ? (
                              <span className="num" style={{ color: 'var(--muted)' }}>
                                —
                              </span>
                            ) : (
                              <span className={`num kw-delta ${r.bidChangePct > 0 ? 'up' : 'down'}`}>
                                {r.bidChangePct > 0 ? '+' : ''}
                                {r.bidChangePct}%
                              </span>
                            )}
                          </td>
                        </tr>
                        {expanded === r.id ? (
                          <tr>
                            <td className="drill-cell" colSpan={11}>
                              <RowDetail r={r} />
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
