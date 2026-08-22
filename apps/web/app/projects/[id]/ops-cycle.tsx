'use client';

import type { OpsPhaseStatus, ProjectDetailDto } from '@adgrid/shared';
import { buildOpsCycle } from '@adgrid/shared';

const STATUS_META: Record<OpsPhaseStatus, { label: string; cls: string }> = {
  done: { label: '完了', cls: 'up' },
  active: { label: '進行中', cls: 'ai' },
  attention: { label: '要対応', cls: 'warn' },
  todo: { label: '未着手', cls: 'flat' },
};

/** プロジェクトの詳細DTOから運用サイクルの入力を組み立てる */
function inputFromDetail(p: ProjectDetailDto) {
  const hasBudget =
    (p.settings.monthlyBudgetTotal ?? 0) > 0 || p.accounts.some((a) => (a.monthlyBudget ?? 0) > 0);
  return {
    projectId: p.id,
    projectName: p.name,
    clientName: p.clientName,
    clientId: p.clientId,
    assets: p.assets.map((a) => ({ status: a.status })),
    alertCount: p.alerts.length,
    openFindings: p.openFindings,
    hasBudget,
    hasCvPoint: !!p.settings.conversionPoint,
    hasConnectedMedia: p.accounts.some((a) => a.connectionStatus === 'connected'),
    lastReportAt: p.lastReportAt,
  };
}

/**
 * AI自律運用サイクル (F-27)。作成→承認→出稿→分析→改善のループを1画面に束ね、
 * 今どのフェーズか・次にやるべき確認/承認を提示する。
 */
export function OpsCycleTab({ project, goTab }: { project: ProjectDetailDto; goTab: (t: string) => void }) {
  const cycle = buildOpsCycle(inputFromDetail(project));

  return (
    <>
      <div className="card ops-hero">
        <div className="c-body">
          <div className="ops-hero-top">
            <div>
              <h2 className="ops-hero-title">🔄 AI自律運用サイクル</h2>
              <p className="ops-hero-sub">
                作成 → 確認・承認 → 出稿 → 分析 → 改善 のループをAIが高速で回し、<b>人は確認・承認だけ</b>。
                このプロジェクトの進行状況と次の一手を示します。
              </p>
            </div>
            <div className="ops-health">
              <div className="ops-health-v">{cycle.healthPct}%</div>
              <div className="ops-health-l">サイクル充足度</div>
            </div>
          </div>

          {cycle.nextAction ? (
            <div className={`ops-next ${cycle.nextAction.severity}`}>
              <div className="ops-next-body">
                <span className="ops-next-badge">次にやること</span>
                <span className="ops-next-label">{cycle.nextAction.label}</span>
                <span className="ops-next-reason">{cycle.nextAction.reason}</span>
              </div>
              <button className="btn pri" onClick={() => goTab(cycle.nextAction!.tab)}>対応する →</button>
            </div>
          ) : (
            <div className="ops-next done">
              <div className="ops-next-body">
                <span className="ops-next-label">✓ いま対応が必要なアクションはありません</span>
                <span className="ops-next-reason">サイクルは順調です。分析・改善を継続しましょう。</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="ops-flow">
        {cycle.phases.map((ph, i) => {
          const m = STATUS_META[ph.status];
          return (
            <div key={ph.key} className="ops-step-wrap">
              <button className={`ops-step ${ph.status}`} onClick={() => goTab(ph.tab)}>
                <div className="ops-step-h">
                  <span className="ops-step-ico">{ph.icon}</span>
                  <span className={`pill ${m.cls}`}>{m.label}</span>
                </div>
                <div className="ops-step-label">{ph.label}</div>
                <div className="ops-step-summary">{ph.summary}</div>
                <ul className="ops-step-tasks">
                  {ph.tasks.map((t) => <li key={t}>{t}</li>)}
                </ul>
              </button>
              {i < cycle.phases.length - 1 ? <span className="ops-arrow" aria-hidden="true">→</span> : <span className="ops-arrow loop" aria-hidden="true">↻</span>}
            </div>
          );
        })}
      </div>
    </>
  );
}
