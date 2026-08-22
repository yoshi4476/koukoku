'use client';

import { useState } from 'react';
import type { AgentRunDto, ProjectDetailDto } from '@adgrid/shared';
import { PROJECT_GOAL_LABEL } from '@adgrid/shared';
import { apiPost, toApiError, type ApiError } from '@/lib/api';
import { formatNumber, formatYen } from '@/lib/format';

const EXAMPLES = [
  '月30万円で来店予約を増やして。女性25-44歳・首都圏',
  'CV100件・CPA5000円で獲得したい',
  '認知重視で全国に月50万円',
];

/**
 * AI運用エージェント (F-43)。1つの指示から、目標→予算→媒体配分→配信設定→
 * クリエイティブ生成→公開準備までAIが一気通貫で実行する。公開は最終確認を残す。
 */
export function AgentPanel({ project, goTab, onChanged }: { project: ProjectDetailDto; goTab: (t: string) => void; onChanged: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [run, setRun] = useState<AgentRunDto | null>(null);

  const submit = () => {
    if (!text.trim() || busy) return;
    setBusy(true); setError(null);
    apiPost<AgentRunDto>(`/projects/${project.id}/agent`, { instruction: text.trim() })
      .then((r) => { setRun(r); onChanged(); })
      .catch((e: unknown) => setError(toApiError(e)))
      .finally(() => setBusy(false));
  };

  return (
    <>
      <div className="card agent-card">
        <div className="c-body">
          <div className="agent-hero">
            <div className="agent-ico">🤖</div>
            <div>
              <h2 className="agent-title">AI運用エージェント（一気通貫）</h2>
              <p className="agent-sub">やりたいことを1行で指示するだけ。AIが<mark>最適な順序で 目標→予算→媒体配分→配信設定→クリエイティブ</mark>まで組み立て、公開の準備を整えます。</p>
            </div>
          </div>
          <textarea className="textarea agent-input" rows={2} value={text} onChange={(e) => setText(e.target.value)}
            placeholder="例: 月30万円で来店予約を増やして。女性25-44歳・首都圏" />
          <div className="agent-examples">
            {EXAMPLES.map((ex) => <button key={ex} className="agent-chip" onClick={() => setText(ex)}>{ex}</button>)}
          </div>
          {error ? <div className="agent-err">{error.message}<br /><span>{error.resolution}</span></div> : null}
          <div className="agent-actions">
            <button className="btn pri" disabled={busy || !text.trim()} onClick={submit}>{busy ? 'AIが実行中…' : '🚀 AIに一気通貫で任せる'}</button>
          </div>
        </div>
      </div>

      {run ? (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="c-head">
            <h2>✓ AIが実行しました</h2>
            {run.mocked ? <span className="pill warn" style={{ marginLeft: 8 }}>テンプレ生成</span> : <span className="pill ai" style={{ marginLeft: 8 }}>✨ AI生成</span>}
            <span className="sub" style={{ marginLeft: 'auto' }}>目的: {PROJECT_GOAL_LABEL[run.goal]}・想定CV {formatNumber(run.expectedCv)}件/月</span>
          </div>
          <div className="c-body">
            <ol className="agent-steps">
              {run.steps.map((s) => (
                <li key={s.key} className="agent-step">
                  <div className="as-title">{s.title}</div>
                  <div className="as-detail">{s.detail}</div>
                </li>
              ))}
            </ol>

            <div className="agent-grid">
              <div className="agent-box">
                <div className="agent-box-h">反映した配信設定</div>
                <div className="agent-kv"><span>月予算</span><b>{formatYen(run.appliedSettings.monthlyBudgetTotal)}</b></div>
                <div className="agent-kv"><span>日予算</span><b>{formatYen(run.appliedSettings.dailyBudget)}</b></div>
                <div className="agent-kv"><span>目標CPA</span><b>{formatYen(run.appliedSettings.targetCpa)}</b></div>
                <div className="agent-kv"><span>ターゲット</span><b>{run.appliedSettings.regions}・{run.appliedSettings.ageRange}</b></div>
              </div>
              <div className="agent-box">
                <div className="agent-box-h">媒体配分</div>
                {run.mediaPlan.map((m) => (
                  <div key={m.platformLabel} className="agent-media">
                    <span className="am-name">{m.platformLabel}</span>
                    <div className="am-bar"><div className="am-fill" style={{ width: `${m.sharePct}%` }} /></div>
                    <span className="am-val">{formatYen(m.monthlyBudget)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="agent-box" style={{ marginTop: 12 }}>
              <div className="agent-box-h">生成した制作物（下書き）</div>
              <ul className="agent-assets">
                {run.createdAssetTitles.map((t, i) => <li key={i}>📝 {t}</li>)}
              </ul>
            </div>

            <div className="agent-next">
              <span>次は制作物のプレビューを確認して公開へ。</span>
              <button className="btn pri" onClick={() => goTab('assets')}>制作物・プレビューへ →</button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
