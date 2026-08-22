'use client';

import { useCallback, useEffect, useState } from 'react';
import type { CreativeGenDto, CreativeVariant } from '@adgrid/shared';
import { apiGet, apiPost, toApiError, type ApiError } from '@/lib/api';
import { ErrorCard, SkeletonLines } from '@/components/ui';

/**
 * 業種+ヒアリングから最適なクリエイティブ案を生成し、選んで制作物に採用する (F-26)。
 * 各案は1訴求軸=1案。見出し/説明/本文/CTA + バナー構成案 + 狙いを提示する。
 */
export function CreativeGenerator({
  projectId,
  onAdopted,
  onClose,
}: {
  projectId: string;
  onAdopted: () => void;
  onClose: () => void;
}) {
  const [data, setData] = useState<CreativeGenDto | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [count, setCount] = useState(4);
  const [busy, setBusy] = useState(false);

  const load = useCallback((n: number) => {
    setLoading(true); setError(null);
    apiGet<CreativeGenDto>(`/projects/${projectId}/creatives?count=${n}`)
      .then((d) => { setData(d); setSel(new Set(d.variants.map((_, i) => i))); })
      .catch((e: unknown) => setError(toApiError(e)))
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => { load(count); }, [load, count]);

  const toggle = (i: number) => setSel((prev) => {
    const next = new Set(prev);
    if (next.has(i)) next.delete(i); else next.add(i);
    return next;
  });

  const adopt = () => {
    if (!data) return;
    const variants: CreativeVariant[] = data.variants.filter((_, i) => sel.has(i));
    if (variants.length === 0) return;
    setBusy(true); setError(null);
    apiPost(`/projects/${projectId}/creatives/adopt`, { variants })
      .then(() => { onAdopted(); onClose(); })
      .catch((e: unknown) => { setError(toApiError(e)); setBusy(false); });
  };

  return (
    <div className="cgen">
      <p className="cgen-lead">
        この業種{data ? `（${data.industryLabel}）` : ''}とヒアリング内容から、<mark>訴求軸ちがいの広告案</mark>を作りました。
        良いものを選んで「制作物に採用」すると、下書きとして登録できます。<b>ヒアリングを詳しく入れるほど内容が具体的になります。</b>
      </p>
      <div className="cgen-toolbar">
        <label className="cgen-count">
          案数
          <select className="input" value={count} onChange={(e) => setCount(Number(e.target.value))} disabled={loading || busy}>
            {[3, 4, 6, 8].map((n) => <option key={n} value={n}>{n}案</option>)}
          </select>
        </label>
        <button className="btn sm sec" onClick={() => load(count)} disabled={loading || busy}>↻ 作り直す</button>
        {data?.mocked ? <span className="pill warn" title="ANTHROPIC_API_KEY 未設定のためテンプレート生成">テンプレ生成</span> : null}
      </div>

      {error ? <ErrorCard error={error} onRetry={() => load(count)} /> : null}
      {loading ? <SkeletonLines count={4} /> : null}

      {data && !loading ? (
        <div className="cgen-list">
          {data.variants.map((v, i) => (
            <label key={i} className={`cgen-card${sel.has(i) ? ' on' : ''}`}>
              <div className="cgen-card-h">
                <input type="checkbox" checked={sel.has(i)} onChange={() => toggle(i)} />
                <span className="pill ai">{v.appealAxis}</span>
                <span className="cgen-cta">CTA: {v.cta}</span>
              </div>
              <div className="cgen-headline">{v.headline}</div>
              <div className="cgen-desc">{v.description}</div>
              <div className="cgen-primary">{v.primaryText}</div>
              <div className="cgen-meta">🎨 {v.bannerConcept}</div>
              <div className="cgen-meta muted">🎯 {v.rationale}</div>
            </label>
          ))}
        </div>
      ) : null}

      <div className="cgen-actions">
        <button className="btn sec" onClick={onClose} disabled={busy}>閉じる</button>
        <button className="btn pri" onClick={adopt} disabled={busy || sel.size === 0}>
          {busy ? '採用中…' : `選んだ ${sel.size} 件を制作物に採用`}
        </button>
      </div>
    </div>
  );
}
