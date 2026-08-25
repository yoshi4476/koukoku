'use client';

import { useEffect, useState } from 'react';
import { LP_CHECK_ITEMS, lpScore } from '@adgrid/shared';

/**
 * LP最適化(ポストクリック) (F-49)。LPのCVR要因をチェックし、100点満点のスコアと
 * 優先度の高い改善提案を出す。チェック状態は閲覧者のブラウザに保存（軽量な自己診断）。
 */
export function LpOptimizer({ assetId, url }: { assetId: string; url: string }) {
  const storeKey = `adgrid_lp_${assetId}`;
  const [checked, setChecked] = useState<string[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storeKey);
      if (raw) setChecked(JSON.parse(raw));
    } catch {
      /* localStorage 不可の環境では空のまま */
    }
  }, [storeKey]);

  const toggle = (key: string) => {
    setChecked((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      try { localStorage.setItem(storeKey, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  const r = lpScore(checked);
  const gradeCls = { good: 'up', warn: 'warn', bad: 'down' }[r.grade];

  return (
    <div className="lpo">
      <p className="lpo-intro">
        クリック後のLPは<mark>成約率（CVR）を直接左右</mark>します。当てはまる項目にチェックすると、スコアと改善優先度が出ます。
        {url ? <> 対象LP: <a href={url} target="_blank" rel="noopener noreferrer">{url} ↗</a></> : null}
      </p>

      <div className={`lpo-score ${gradeCls}`}>
        <div className="lpo-score-v">{r.score}<span>/100</span></div>
        <div className="lpo-bar"><div className={`lpo-fill ${gradeCls}`} style={{ width: `${r.score}%` }} /></div>
        <div className="lpo-summary">{r.summary}</div>
      </div>

      {r.topFixes.length > 0 ? (
        <div className="lpo-fixes">
          <div className="lpo-fixes-h">🎯 まず直すと効く（優先）</div>
          {r.topFixes.map((f, i) => (
            <div key={i} className="lpo-fix"><b>{f.label}</b><span>{f.hint}</span></div>
          ))}
        </div>
      ) : null}

      <div className="lpo-list">
        <div className="lpo-list-h">チェックリスト（{checked.length}/{LP_CHECK_ITEMS.length}）</div>
        {r.items.map((it) => (
          <label key={it.key} className={`lpo-item${it.done ? ' on' : ''}`}>
            <input type="checkbox" checked={it.done} onChange={() => toggle(it.key)} />
            <span className="lpo-label">{it.label}</span>
            <span className="lpo-weight">{it.weight}pt</span>
          </label>
        ))}
      </div>
      <p className="lpo-note">※ このチェックはこの端末に保存されます。計測タグは「クライアント → 📡計測」ともあわせて確認してください。</p>
    </div>
  );
}
