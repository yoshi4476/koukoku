'use client';

import { useRouter } from 'next/navigation';
import type { ProjectDto } from '@adgrid/shared';
import { buildOpsCycle } from '@adgrid/shared';
import { useApi } from '@/components/use-api';
import { ErrorCard, SkeletonLines } from '@/components/ui';

/**
 * ホームの全プロジェクト横断「AI自律運用サイクル」ボード (F-27)。
 * 各プロジェクトの次アクションを集約し、要対応を上に並べる。
 */
export function OpsBoard() {
  const router = useRouter();
  const { data, loading, error, retry } = useApi<ProjectDto[]>('/projects');

  const cycles = (data ?? []).map((p: ProjectDto) =>
    buildOpsCycle({
      projectId: p.id,
      projectName: p.name,
      clientName: p.clientName,
      clientId: p.clientId,
      assetCount: p.assetCount,
      publishedCount: p.publishedCount,
      alertCount: p.alertCount,
      openFindings: p.openFindings,
      hasBudget: p.cost7d > 0 || p.publishedCount > 0,
      lastReportAt: p.lastReportAt,
      cpaDelta: p.cpaDelta,
    }),
  );
  const withAction = cycles.filter((c) => c.nextAction);
  withAction.sort((a, b) => {
    const sa = a.nextAction!.severity === 'attention' ? 0 : 1;
    const sb = b.nextAction!.severity === 'attention' ? 0 : 1;
    return sa - sb;
  });
  const pending = cycles.reduce((s, c) => s + c.pendingCount, 0);

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="c-head">
        <h2>🤖 AI自律運用サイクル</h2>
        {data ? (
          <span className="sub" style={{ marginLeft: 'auto' }}>
            運用中 <b className="num">{cycles.length}</b> 件 / 要対応 <b className="num" style={{ color: pending > 0 ? 'var(--warn)' : 'var(--good)' }}>{pending}</b> 件
          </span>
        ) : null}
      </div>
      <div className="c-body">
        {loading ? <SkeletonLines count={3} /> : null}
        {error ? <ErrorCard error={error} onRetry={retry} /> : null}
        {data && cycles.length === 0 ? (
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13 }}>
            プロジェクトを作成すると、作成→承認→出稿→分析→改善のサイクルと次アクションがここに並びます。
          </p>
        ) : null}
        {data && withAction.length === 0 && cycles.length > 0 ? (
          <p style={{ margin: 0, color: 'var(--good)', fontWeight: 600, fontSize: 13 }}>✓ すべてのプロジェクトが順調です。対応待ちのアクションはありません。</p>
        ) : null}
        {withAction.length > 0 ? (
          <div className="opsb-list">
            {withAction.map((c) => (
              <button key={c.projectId} className={`opsb-row ${c.nextAction!.severity}`} onClick={() => router.push(`/projects/${c.projectId}`)}>
                <div className="opsb-main">
                  <div className="opsb-proj">{c.projectName} <span className="opsb-client">{c.clientName}</span></div>
                  <div className="opsb-action">{c.nextAction!.label}</div>
                  <div className="opsb-reason">{c.nextAction!.reason}</div>
                </div>
                <div className="opsb-side">
                  <span className={`pill ${c.nextAction!.severity === 'attention' ? 'warn' : 'flat'}`}>
                    {c.nextAction!.severity === 'attention' ? '要対応' : '推奨'}
                  </span>
                  <span className="opsb-health">{c.healthPct}%</span>
                </div>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
