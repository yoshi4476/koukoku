'use client';

import { useState } from 'react';
import type { ProjectBrief, ProjectGoal } from '@adgrid/shared';
import { buildMediaPrompts } from '@adgrid/shared';

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(value).then(
      () => { setCopied(true); setTimeout(() => setCopied(false), 1500); },
      () => undefined,
    );
  };
  return (
    <div className="mpp-row">
      <div className="mpp-row-h">
        <span className="mpp-label">{label}</span>
        <button className="btn sm sec" onClick={copy}>{copied ? '✓ コピー済' : 'コピー'}</button>
      </div>
      <textarea className="mpp-text" readOnly value={value} rows={value.length > 160 ? 4 : 2} onFocus={(e) => e.target.select()} />
    </div>
  );
}

/**
 * 画像・動画 生成プロンプトの提示 (F-32)。業種・ヒアリング・見出しから外部の
 * 画像/動画AIに貼るだけのプロンプトを生成し、おすすめAPIも案内する。
 */
export function MediaPromptPanel({
  industryCode, brief, headline, goal,
}: { industryCode: string; brief: ProjectBrief; headline: string; goal: ProjectGoal }) {
  const m = buildMediaPrompts(industryCode, brief, headline, goal);
  return (
    <div className="mpp">
      <p className="mpp-intro">下のプロンプトを<mark>画像/動画生成AIに貼る</mark>だけ。業種とヒアリングに合わせて最適化済みです。{m.styleNote}</p>

      <div className="mpp-sec-h">🖼 画像生成プロンプト</div>
      <CopyRow label="英語（推奨・高品質）" value={m.imagePrompt} />
      <CopyRow label="日本語" value={m.imagePromptJa} />
      <CopyRow label="除外指定 (negative prompt)" value={m.negativePrompt} />
      <div className="mpp-ratios">推奨サイズ: {m.aspectRatios.map((r) => `${r.label} ${r.ratio}`).join(' / ')}</div>

      <div className="mpp-sec-h">🎬 動画生成プロンプト</div>
      <CopyRow label="英語（縦型・6〜8秒）" value={m.videoPrompt} />

      <div className="mpp-apis">
        <div className="mpp-api-col">
          <div className="mpp-api-h">おすすめ画像API</div>
          {m.imageApis.map((a) => <div key={a.name} className="mpp-api"><b>{a.name}</b><span>{a.note}</span></div>)}
        </div>
        <div className="mpp-api-col">
          <div className="mpp-api-h">おすすめ動画API</div>
          {m.videoApis.map((a) => <div key={a.name} className="mpp-api"><b>{a.name}</b><span>{a.note}</span></div>)}
        </div>
      </div>
      <p className="mpp-note">※ 生成した画像/動画は「🖼 画像/動画」からアップロードし、「自動バナー」で文字を載せると崩れません。</p>
    </div>
  );
}
