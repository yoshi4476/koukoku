'use client';

import type { ProjectGoal } from '@adgrid/shared';
import { buildFunnel } from '@adgrid/shared';

/**
 * 業種別 導線設計 (カスタマージャーニー) (F-28)。
 * 業種の勝ち筋の導線を「認知→比較→獲得→リピート」で提示。各段階の媒体・訴求・
 * KPI・計測ポイントを示し、素人でもプロの導線を組めるようにする。
 */
export function FunnelBox({ industryCode, goal }: { industryCode: string; goal: ProjectGoal }) {
  const f = buildFunnel(industryCode, goal);
  return (
    <div className="funnel">
      <div className="funnel-head">
        <div className="funnel-title">🧭 業種別 導線設計（カスタマージャーニー）</div>
        <span className="funnel-ind">{f.industryLabel}</span>
      </div>
      <p className="funnel-summary">{f.summary}</p>
      <div className="funnel-flow">
        {f.stages.map((st, i) => (
          <div key={st.key} className="funnel-step-wrap">
            <div className="funnel-step">
              <div className="funnel-step-h">
                <span className="funnel-num">STEP {i + 1}</span>
                <span className="funnel-label">{st.label}</span>
              </div>
              <div className="funnel-goal">{st.goal}</div>
              <div className="funnel-plats">
                {st.platforms.map((p) => <span key={p} className="funnel-chip">{p}</span>)}
              </div>
              <div className="funnel-kv"><span className="funnel-k">訴求</span>{st.creative}</div>
              <div className="funnel-kv"><span className="funnel-k">KPI</span>{st.kpi}</div>
              <div className="funnel-kv"><span className="funnel-k">計測</span>{st.measure}</div>
            </div>
            {i < f.stages.length - 1 ? <span className="funnel-arrow" aria-hidden="true">▼</span> : null}
          </div>
        ))}
      </div>
      <p className="funnel-note">※ 上の「最適な打ち出し方（媒体プラン）」で予算配分を、下の設定で金額・ターゲティングを決めると、この導線が形になります。</p>
    </div>
  );
}
