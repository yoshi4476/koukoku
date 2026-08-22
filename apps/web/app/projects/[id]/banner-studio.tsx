'use client';

import { useMemo, useRef, useState } from 'react';

/**
 * 自動バナー生成 (F-30)。制作物の見出し・訴求・CTAと業種カラーから、実際に使える
 * バナー画像(SVG)を組み立て、PNGでダウンロードできる。外部の画像AIを使わず動作する。
 * 本格的な写真生成が必要な場合は、ここに画像生成APIを差し込める。
 */

type SizeKey = 'square' | 'landscape' | 'portrait';
const SIZES: Record<SizeKey, { w: number; h: number; label: string }> = {
  square: { w: 1080, h: 1080, label: '正方形 1:1' },
  landscape: { w: 1200, h: 628, label: '横長 1.91:1' },
  portrait: { w: 1080, h: 1350, label: '縦長 4:5' },
};

/** 業種コードから決定的にアクセント色相を決める */
function hueOf(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return h;
}

/** 日本語向けの単純な字数折り返し (最大行数でカット) */
function wrap(text: string, maxChars: number, maxLines: number): string[] {
  const t = (text ?? '').trim();
  if (!t) return [];
  const lines: string[] = [];
  let rest = t;
  while (rest.length && lines.length < maxLines) {
    lines.push(rest.slice(0, maxChars));
    rest = rest.slice(maxChars);
  }
  if (rest.length && lines.length === maxLines) {
    lines[maxLines - 1] = lines[maxLines - 1].replace(/.$/, '…');
  }
  return lines;
}

export function BannerStudio({
  headline,
  sub,
  cta,
  brand,
  seed,
}: {
  headline: string;
  sub: string;
  cta: string;
  brand: string;
  seed: string;
}) {
  const [size, setSize] = useState<SizeKey>('square');
  const svgRef = useRef<SVGSVGElement>(null);
  const [downloading, setDownloading] = useState(false);

  const hue = useMemo(() => hueOf(seed || headline || 'adgrid'), [seed, headline]);
  const { w, h } = SIZES[size];
  const c1 = `hsl(${hue} 60% 42%)`;
  const c2 = `hsl(${(hue + 28) % 360} 64% 26%)`;
  const accent = `hsl(${(hue + 40) % 360} 85% 62%)`;

  // レイアウト寸法 (基準1080幅でスケール)
  const s = w / 1080;
  const pad = 84 * s;
  const hlSize = (size === 'landscape' ? 66 : 82) * s;
  const hlLines = wrap(headline || '見出しを入力', size === 'landscape' ? 12 : 11, 3);
  const subLines = wrap(sub || '', size === 'landscape' ? 20 : 16, 2);
  const hlTop = h * (size === 'portrait' ? 0.30 : 0.28);

  const download = () => {
    const svg = svgRef.current;
    if (!svg) return;
    setDownloading(true);
    const xml = new XMLSerializer().serializeToString(svg);
    const svg64 = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(xml)));
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, w, h);
        const a = document.createElement('a');
        a.href = canvas.toDataURL('image/png');
        a.download = `banner_${size}_${(brand || 'adgrid').slice(0, 12)}.png`;
        a.click();
      }
      setDownloading(false);
    };
    img.onerror = () => setDownloading(false);
    img.src = svg64;
  };

  return (
    <div className="bstudio">
      <div className="bstudio-toolbar">
        <div className="bstudio-sizes">
          {(Object.keys(SIZES) as SizeKey[]).map((k) => (
            <button key={k} className={`bstudio-size${size === k ? ' on' : ''}`} onClick={() => setSize(k)}>
              {SIZES[k].label}
            </button>
          ))}
        </div>
        <button className="btn sm pri" onClick={download} disabled={downloading}>
          {downloading ? '生成中…' : '⬇ PNGで保存'}
        </button>
      </div>

      <div className="bstudio-stage">
        <svg
          ref={svgRef}
          className="bstudio-svg"
          width={w}
          height={h}
          viewBox={`0 0 ${w} ${h}`}
          xmlns="http://www.w3.org/2000/svg"
          role="img"
          aria-label="自動生成バナー"
        >
          <defs>
            <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor={c1} />
              <stop offset="1" stopColor={c2} />
            </linearGradient>
          </defs>
          <rect width={w} height={h} fill="url(#bg)" />
          {/* 装飾: 斜めのアクセント帯 */}
          <rect x={w * 0.62} y={-h * 0.1} width={w * 0.7} height={h * 1.2} fill={accent} opacity="0.10" transform={`rotate(18 ${w * 0.7} ${h * 0.5})`} />
          {/* CTAピル位置の基準線 */}
          <text x={pad} y={pad + 30 * s} fill="#fff" opacity="0.9" fontSize={26 * s} fontWeight="700" fontFamily="'Noto Sans JP',sans-serif">
            {brand || '広告主'}
          </text>

          {hlLines.map((ln, i) => (
            <text key={i} x={pad} y={hlTop + i * hlSize * 1.18} fill="#fff" fontSize={hlSize} fontWeight="800"
              fontFamily="'Zen Kaku Gothic New','Noto Sans JP',sans-serif" style={{ letterSpacing: '-0.5px' }}>
              {ln}
            </text>
          ))}

          {subLines.map((ln, i) => (
            <text key={i} x={pad} y={hlTop + hlLines.length * hlSize * 1.18 + 40 * s + i * 40 * s}
              fill="#fff" opacity="0.92" fontSize={30 * s} fontWeight="500" fontFamily="'Noto Sans JP',sans-serif">
              {ln}
            </text>
          ))}

          {/* CTA ピル */}
          <g>
            <rect x={pad} y={h - pad - 76 * s} rx={40 * s} ry={40 * s} width={(cta.length * 34 + 96) * s} height={76 * s} fill="#fff" />
            <text x={pad + 48 * s} y={h - pad - 76 * s + 50 * s} fill={c2} fontSize={32 * s} fontWeight="800"
              fontFamily="'Zen Kaku Gothic New','Noto Sans JP',sans-serif">
              {cta || '詳しくはこちら'}
            </text>
          </g>
        </svg>
      </div>
      <p className="bstudio-note">※ 見出し・訴求・業種カラーから自動生成した下書きバナーです。実素材や写真は「画像/動画」から差し替えられます。</p>
    </div>
  );
}
