'use client';

import { useState } from 'react';
import type { KeywordPlanDto } from '@adgrid/shared';
import { INTENT_LABEL } from '@adgrid/shared';
import { ErrorCard, SkeletonLines } from '@/components/ui';
import { apiGet, apiPost, toApiError, type ApiError } from '@/lib/api';

const TIER_CLS: Record<string, string> = { now: 'up', compare: 'warn', explore: 'flat' };

/**
 * 検索キーワードの自動設計 (F-57)。
 * CPAはキーワード選定でほぼ決まるため、検索意図の強い語から層別に提示し、
 * 無駄クリックを生む語は除外キーワードとして一緒に登録する。
 */
export function KeywordPlanner({ projectId, canEdit, onSaved }: {
  projectId: string; canEdit: boolean; onSaved: () => void;
}) {
  const [plan, setPlan] = useState<KeywordPlanDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState('');
  const [includeExplore, setIncludeExplore] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const generate = () => {
    setLoading(true); setError(null); setApplied('');
    apiGet<KeywordPlanDto>(`/projects/${projectId}/keyword-plan`)
      .then(setPlan)
      .catch((e: unknown) => setError(toApiError(e)))
      .finally(() => setLoading(false));
  };

  const apply = () => {
    if (!plan) return;
    setApplying(true); setError(null);
    apiPost<{ keywordCount: number; negativeCount: number }>(`/projects/${projectId}/keyword-plan/apply`, { plan, includeExplore })
      .then((r) => { setApplied(`キーワード${r.keywordCount}語・除外${r.negativeCount}語を配信設定に反映しました。`); onSaved(); })
      .catch((e: unknown) => setError(toApiError(e)))
      .finally(() => setApplying(false));
  };

  const counts = plan
    ? (['now', 'compare', 'explore'] as const).map((t) => ({ t, n: plan.keywords.filter((k) => k.tier === t).length }))
    : [];

  return (
    <div className="kwp">
      <div className="kwp-head">
        <div className="kwp-t">
          <b>🎯 検索キーワードをAIで設計</b>
          <span>ヒアリングと業種から、<mark>発注意図の強い語</mark>を中心に設計します。成果（CPA）はキーワード選定でほぼ決まります。</span>
        </div>
        {canEdit ? (
          <button type="button" className="btn sm pri" onClick={generate} disabled={loading}>
            {loading ? '設計中…' : plan ? '作り直す' : 'AIで設計する'}
          </button>
        ) : null}
      </div>

      {error ? <ErrorCard error={error} onRetry={generate} /> : null}
      {loading ? <SkeletonLines count={3} /> : null}

      {plan ? (
        <>
          <div className="kwp-counts">
            {counts.map(({ t, n }) => (
              <span key={t} className={`pill ${TIER_CLS[t]}`}>{INTENT_LABEL[t]} {n}語</span>
            ))}
            {plan.mocked ? <span className="pill flat">テンプレ設計</span> : <span className="pill ai">AI設計</span>}
          </div>
          <p className="kwp-note">{plan.note}</p>

          <div className="kwp-list">
            {(['now', 'compare', 'explore'] as const).map((t) => {
              const items = plan.keywords.filter((k) => k.tier === t);
              if (items.length === 0) return null;
              return (
                <div className="kwp-group" key={t}>
                  <div className={`kwp-g-h ${TIER_CLS[t]}`}>{INTENT_LABEL[t]}</div>
                  {items.map((k, i) => (
                    <div className="kwp-row" key={i}>
                      <span className="kwp-kw">{k.text}</span>
                      <span className="kwp-why">{k.reason}</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>

          {plan.negatives.length > 0 ? (
            <details className="kwp-neg">
              <summary>除外キーワード {plan.negatives.length}語（無駄クリックを防ぎます）</summary>
              <div className="kwp-neg-list">{plan.negatives.map((n, i) => <span className="tag" key={i}>{n}</span>)}</div>
            </details>
          ) : null}

          {canEdit ? (
            <div className="kwp-actions">
              <label className="set-check">
                <input type="checkbox" checked={includeExplore} onChange={(e) => setIncludeExplore(e.target.checked)} />
                情報収集層も含める（CPAは悪化しやすい）
              </label>
              <button type="button" className="btn sm pri" onClick={apply} disabled={applying}>
                {applying ? '反映中…' : '配信設定に反映する'}
              </button>
              {applied ? <span className="kwp-ok">✓ {applied}</span> : null}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
