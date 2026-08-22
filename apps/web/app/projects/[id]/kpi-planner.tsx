'use client';

import { useState } from 'react';
import type { ProjectSettings } from '@adgrid/shared';
import { buildKpiTree } from '@adgrid/shared';
import { formatNumber, formatYen } from '@/lib/format';

/**
 * KPIツリー / 逆算プランナー (F-37)。
 * 目標CVから、業種相場(CTR/CVR/CPA)で必要な予算・IMP・クリックを逆算する。
 * 自社実績を入れれば精緻化。結果を配信設定(月予算・目標CPA・目標CV)へ反映できる。
 */
export function KpiPlanner({
  industryCode, settings, canEdit, onApply,
}: {
  industryCode: string; settings: ProjectSettings; canEdit: boolean;
  onApply: (patch: Partial<ProjectSettings>) => void;
}) {
  const [targetCv, setTargetCv] = useState<string>(settings.targetCv ? String(settings.targetCv) : '100');
  const [targetCpa, setTargetCpa] = useState<string>(settings.targetCpa ? String(settings.targetCpa) : '');
  const [ctr, setCtr] = useState('');
  const [cvr, setCvr] = useState('');
  const [aov, setAov] = useState('');

  const num = (s: string) => { const n = Number(s.replace(/,/g, '')); return s.trim() === '' || Number.isNaN(n) ? null : n; };
  const tree = buildKpiTree({
    industryCode,
    targetCv: num(targetCv) ?? 0,
    targetCpa: num(targetCpa),
    ctr: num(ctr),
    cvr: num(cvr),
    avgOrderValue: num(aov),
  });
  const srcLabel = { benchmark: '業種相場', mixed: '相場＋自社実績', custom: '自社実績' }[tree.assumptions.source];

  return (
    <div className="kpit">
      <div className="kpit-head">
        <div className="kpit-title">🎯 KPIツリー（逆算プランナー）</div>
        <span className="kpit-src">前提: {srcLabel}（CTR {tree.assumptions.ctr}% / CVR {tree.assumptions.cvr}% / CPA {formatYen(tree.assumptions.cpa)}）</span>
      </div>
      <p className="kpit-lead">目標CVから、この業種の相場で<mark>必要な予算・表示回数・クリック</mark>を逆算します。自社実績が分かれば入力すると精度が上がります。</p>

      <div className="kpit-inputs">
        <label className="kpit-field"><span>目標CV（件/月）</span>
          <input className="input" inputMode="numeric" value={targetCv} onChange={(e) => setTargetCv(e.target.value)} placeholder="100" /></label>
        <label className="kpit-field"><span>目標CPA（円・任意）</span>
          <input className="input" inputMode="numeric" value={targetCpa} onChange={(e) => setTargetCpa(e.target.value)} placeholder="相場を使用" /></label>
        <label className="kpit-field"><span>CTR（%・任意）</span>
          <input className="input" inputMode="decimal" value={ctr} onChange={(e) => setCtr(e.target.value)} placeholder="相場" /></label>
        <label className="kpit-field"><span>CVR（%・任意）</span>
          <input className="input" inputMode="decimal" value={cvr} onChange={(e) => setCvr(e.target.value)} placeholder="相場" /></label>
        <label className="kpit-field"><span>客単価（円・任意）</span>
          <input className="input" inputMode="numeric" value={aov} onChange={(e) => setAov(e.target.value)} placeholder="売上・ROAS算出" /></label>
      </div>

      <div className="kpit-tree">
        <div className="kpit-node lead"><div className="kn-l">必要 表示回数 (IMP)</div><div className="kn-v">{formatNumber(tree.impressions)}</div><div className="kn-s">CPM {formatYen(tree.cpm)}</div></div>
        <div className="kpit-arrow">× CTR {tree.ctr}% →</div>
        <div className="kpit-node"><div className="kn-l">必要 クリック</div><div className="kn-v">{formatNumber(tree.clicks)}</div><div className="kn-s">CPC {formatYen(tree.cpc)}</div></div>
        <div className="kpit-arrow">× CVR {tree.cvr}% →</div>
        <div className="kpit-node goal"><div className="kn-l">目標 CV</div><div className="kn-v">{formatNumber(tree.cv)}</div><div className="kn-s">CPA {formatYen(tree.cpa)}</div></div>
      </div>

      <div className="kpit-budget">
        <div className="kb-item"><span>必要 月予算</span><b>{formatYen(tree.monthlyBudget)}</b></div>
        <div className="kb-item"><span>日予算の目安</span><b>{formatYen(tree.dailyBudget)}</b></div>
        {tree.revenue !== null ? <div className="kb-item"><span>想定売上</span><b>{formatYen(tree.revenue)}</b></div> : null}
        {tree.roas !== null ? <div className="kb-item"><span>想定ROAS</span><b>{tree.roas}%</b></div> : null}
        {canEdit ? (
          <button className="btn sm pri" style={{ marginLeft: 'auto' }}
            onClick={() => onApply({ monthlyBudgetTotal: tree.monthlyBudget, dailyBudget: tree.dailyBudget, targetCv: tree.cv, targetCpa: tree.cpa })}>
            この予算・目標を反映
          </button>
        ) : null}
      </div>
      <p className="kpit-note">※ 相場は業種平均です。運用実績が溜まったら実CTR/CVR/CPAで再計算するとより正確になります。</p>
    </div>
  );
}
