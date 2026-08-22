'use client';

import { useState } from 'react';
import type { ImageGenResultDto, ProjectBrief, ProjectGoal } from '@adgrid/shared';
import { buildMediaPrompts } from '@adgrid/shared';
import { apiPost, toApiError, type ApiError } from '@/lib/api';
import { formatYen } from '@/lib/format';

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
const ASPECTS = [
  { label: '正方形 1:1', ratio: '1:1' },
  { label: '縦 9:16', ratio: '9:16' },
  { label: '横 16:9', ratio: '16:9' },
];

export function MediaPromptPanel({
  industryCode, brief, headline, goal, assetId, onGenerated,
}: {
  industryCode: string; brief: ProjectBrief; headline: string; goal: ProjectGoal;
  assetId?: string; onGenerated?: () => void;
}) {
  const m = buildMediaPrompts(industryCode, brief, headline, goal);
  const [aspect, setAspect] = useState('1:1');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const [done, setDone] = useState<ImageGenResultDto | null>(null);

  const generate = () => {
    if (!assetId) return;
    setBusy(true); setErr(null); setDone(null);
    apiPost<ImageGenResultDto>(`/projects/assets/${assetId}/generate-image`, { prompt: m.imagePrompt, aspectRatio: aspect, model: 'imagen-4.0-ultra-generate-001', count: 1 })
      .then((r) => { setDone(r); onGenerated?.(); })
      .catch((e: unknown) => setErr(toApiError(e)))
      .finally(() => setBusy(false));
  };

  return (
    <div className="mpp">
      <p className="mpp-intro">下のプロンプトを<mark>画像/動画生成AIに貼る</mark>だけ。業種とヒアリングに合わせて最適化済みです。{m.styleNote}</p>

      {assetId ? (
        <div className="mpp-gen">
          <div className="mpp-gen-h">
            <span className="mpp-gen-t">✨ Imagen 4 Ultra で画像生成</span>
            <div className="mpp-gen-aspect">
              {ASPECTS.map((a) => (
                <button key={a.ratio} className={`bstudio-chip${aspect === a.ratio ? ' on' : ''}`} onClick={() => setAspect(a.ratio)}>{a.label}</button>
              ))}
            </div>
            <button className="btn sm pri" onClick={generate} disabled={busy}>{busy ? '生成中…（数十秒）' : '画像を生成'}</button>
          </div>
          {done ? <div className="mpp-gen-ok">✓ 生成しました（{done.count}枚・原価 {formatYen(done.costJpy)}）。制作物に添付済み。プレビューを開き直すと反映されます。</div> : null}
          {err ? <div className="mpp-gen-err">{err.message}<br /><span>{err.resolution}</span></div> : null}
          <p className="mpp-gen-note">※ 生成画像1枚 約¥9（Ultra）。Google Cloud側の課金で、当システムの「AI利用量」にも合算計上されます。GEMINI_API_KEY 未設定時は案内が出ます。</p>
        </div>
      ) : null}

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
