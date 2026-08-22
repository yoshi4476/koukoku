'use client';

import { useCallback, useEffect, useState } from 'react';
import type { PreflightDto } from '@adgrid/shared';
import { apiDelete, apiGet, toApiError, type ApiError } from '@/lib/api';
import { ErrorCard, SkeletonLines } from '@/components/ui';

const LEVEL_META: Record<string, { cls: string; label: string }> = {
  block: { cls: 'down', label: '要修正' },
  warn: { cls: 'warn', label: '注意' },
  info: { cls: 'flat', label: '情報' },
};

/**
 * 公開前の徹底チェック (F-35)。配信できない制作物・審査リスク・設定不足を洗い出し、
 * 展開できない制作物はその場で削除できる。
 */
export function PreflightPanel({ projectId, onChanged }: { projectId: string; onChanged: () => void }) {
  const [data, setData] = useState<PreflightDto | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true); setError(null);
    apiGet<PreflightDto>(`/projects/${projectId}/preflight`)
      .then(setData)
      .catch((e: unknown) => setError(toApiError(e)))
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const del = (assetId: string) => {
    setDeleting(assetId);
    apiDelete(`/projects/assets/${assetId}`)
      .then(() => { onChanged(); load(); })
      .catch((e: unknown) => setError(toApiError(e)))
      .finally(() => setDeleting(null));
  };

  if (loading) return <SkeletonLines count={4} />;
  if (error) return <ErrorCard error={error} onRetry={load} />;
  if (!data) return null;

  return (
    <div className="pfl">
      <div className={`pfl-head ${data.ready ? 'ok' : 'ng'}`}>
        <span className="pfl-icon">{data.ready ? '✓' : '!'}</span>
        <div>
          <div className="pfl-title">{data.ready ? '公開できます' : '公開前に修正が必要です'}</div>
          <div className="pfl-sub">配信できる制作物 {data.deployableAssets}/{data.totalAssets} 件・指摘 {data.issues.length} 件</div>
        </div>
        <button className="btn sm sec" style={{ marginLeft: 'auto' }} onClick={load}>再チェック</button>
      </div>

      {data.undeployable.length > 0 ? (
        <div className="pfl-sec">
          <div className="pfl-sec-h">🗑 配信できない制作物（削除候補）</div>
          {data.undeployable.map((u) => (
            <div key={u.assetId} className="pfl-undep">
              <div className="pfl-undep-main">
                <span className="pfl-undep-title">{u.title || '(無題)'}</span>
                <span className="pfl-undep-reason">{u.reason}</span>
              </div>
              <button className="btn sm danger" disabled={deleting === u.assetId} onClick={() => del(u.assetId)}>
                {deleting === u.assetId ? '削除中…' : '削除'}
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="pfl-sec">
        <div className="pfl-sec-h">チェック結果</div>
        {data.issues.length === 0 ? (
          <p style={{ margin: 0, color: 'var(--good)', fontWeight: 600, fontSize: 13 }}>✓ 問題は見つかりませんでした。</p>
        ) : (
          <div className="pfl-issues">
            {data.issues.map((it, i) => {
              const m = LEVEL_META[it.level];
              return (
                <div key={i} className={`pfl-issue ${it.level}`}>
                  <span className={`pill ${m.cls}`}>{m.label}</span>
                  <div className="pfl-issue-body">
                    <div className="pfl-issue-title">{it.title}</div>
                    <div className="pfl-issue-detail">{it.detail}</div>
                    <div className="pfl-issue-sug">→ {it.suggestion}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
