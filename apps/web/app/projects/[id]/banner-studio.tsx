'use client';

import { useMemo, useRef, useState } from 'react';

/**
 * 自動バナー生成 (F-30 / F-33 品質強化)。制作物の見出し・訴求・CTAと業種カラーから、
 * 洗練されたバナー画像(SVG)を組み立て、PNGでダウンロードできる。外部の画像AIを使わず動作する。
 * レイアウト3種 × カラーテーマ8種 × サイズ3種。写真素材は「画像/動画」から重ねられる。
 */

type SizeKey = 'square' | 'portrait' | 'landscape';
const SIZES: Record<SizeKey, { w: number; h: number; label: string }> = {
  square: { w: 1080, h: 1080, label: '正方形 1:1' },
  portrait: { w: 1080, h: 1350, label: '縦長 4:5' },
  landscape: { w: 1200, h: 628, label: '横長 1.91:1' },
};

type Layout = 'bold' | 'center' | 'block';
const LAYOUTS: { k: Layout; label: string }[] = [
  { k: 'bold', label: '左寄せ' },
  { k: 'center', label: '中央' },
  { k: 'block', label: 'カラーブロック' },
];

interface Theme { k: string; c1: string; c2: string; accent: string; }
const THEMES: Theme[] = [
  { k: 'indigo', c1: '#3E5AD9', c2: '#182A73', accent: '#9DB2FF' },
  { k: 'sunset', c1: '#E4632A', c2: '#7C2413', accent: '#FFC59E' },
  { k: 'emerald', c1: '#0FA06E', c2: '#0A4635', accent: '#8DE9C4' },
  { k: 'rose', c1: '#D8447C', c2: '#6E1A3E', accent: '#FFB0D0' },
  { k: 'plum', c1: '#7A38E6', c2: '#371C69', accent: '#CBB4FF' },
  { k: 'teal', c1: '#0E86A8', c2: '#083E52', accent: '#88D8E8' },
  { k: 'amber', c1: '#CF8A10', c2: '#5E3D05', accent: '#FFE0A0' },
  { k: 'slate', c1: '#3A4A63', c2: '#111C2E', accent: '#9DB0CC' },
];

function hashOf(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h;
}

/** 日本語向けの字数折り返し (最大行数でカット) */
function wrap(text: string, maxChars: number, maxLines: number): string[] {
  const t = (text ?? '').trim();
  if (!t) return [];
  const lines: string[] = [];
  let rest = t;
  while (rest.length && lines.length < maxLines) {
    lines.push(rest.slice(0, maxChars));
    rest = rest.slice(maxChars);
  }
  if (rest.length && lines.length === maxLines) lines[maxLines - 1] = lines[maxLines - 1].replace(/.$/, '…');
  return lines;
}

const F_DISP = "'Zen Kaku Gothic New','Noto Sans JP','Yu Gothic',sans-serif";
const F_BODY = "'Noto Sans JP','Yu Gothic',sans-serif";

export function BannerStudio({
  headline, sub, cta, brand, seed,
}: { headline: string; sub: string; cta: string; brand: string; seed: string; }) {
  const [size, setSize] = useState<SizeKey>('square');
  const [layout, setLayout] = useState<Layout>('bold');
  const h0 = useMemo(() => hashOf(seed || headline || 'adgrid'), [seed, headline]);
  const [themeIdx, setThemeIdx] = useState<number>(h0 % THEMES.length);
  const svgRef = useRef<SVGSVGElement>(null);
  const [downloading, setDownloading] = useState(false);

  const theme = THEMES[themeIdx];
  const { w, h } = SIZES[size];
  const s = w / 1080;
  const pad = 76 * s;

  const blockW = w * 0.40;
  const hl = headline || '見出しを入力';
  const maxChars = size === 'landscape' ? (layout === 'block' ? 10 : 13) : layout === 'block' ? 9 : 11;
  const hlLines = wrap(hl, maxChars, 3);
  const longest = Math.max(...hlLines.map((l) => l.length), 1);
  // 見出しの利用可能幅 (レイアウト別)。全角=約1emで自動フィットする
  const availW = layout === 'block' ? w - (blockW + 52 * s) - pad : w - pad * 2;
  const baseHl = size === 'landscape' ? 96 : 128;
  const hlSize = Math.min(baseHl, (availW / longest) * 0.96);
  const subLines = wrap(sub || '', size === 'landscape' ? 22 : 18, 2);

  const gid = `g${themeIdx}${size}${layout}`;
  const ctaW = Math.min(w - pad * 2, (cta || '詳しくはこちら').length * 34 * s + 130 * s);

  // レイアウト別のテキスト起点
  const centered = layout === 'center';
  const textX = layout === 'block' ? blockW + 52 * s : centered ? w / 2 : pad;
  const anchor = centered ? 'middle' : 'start';
  const hlTop = centered ? h * 0.40 - (hlLines.length - 1) * hlSize * 0.5 : h * (size === 'portrait' ? 0.36 : 0.34);
  const brandX = layout === 'block' ? blockW + 52 * s : centered ? w / 2 : pad;

  const download = () => {
    const svg = svgRef.current; if (!svg) return;
    setDownloading(true);
    const xml = new XMLSerializer().serializeToString(svg);
    const src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(xml)));
    const img = new Image();
    img.onload = () => {
      const scale = 2; // 高解像度出力
      const canvas = document.createElement('canvas');
      canvas.width = w * scale; canvas.height = h * scale;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, w * scale, h * scale);
        const a = document.createElement('a');
        a.href = canvas.toDataURL('image/png');
        a.download = `banner_${size}_${(brand || 'adgrid').slice(0, 12)}.png`;
        a.click();
      }
      setDownloading(false);
    };
    img.onerror = () => setDownloading(false);
    img.src = src;
  };

  return (
    <div className="bstudio">
      <div className="bstudio-toolbar">
        <div className="bstudio-group">
          {(Object.keys(SIZES) as SizeKey[]).map((k) => (
            <button key={k} className={`bstudio-chip${size === k ? ' on' : ''}`} onClick={() => setSize(k)}>{SIZES[k].label}</button>
          ))}
        </div>
        <button className="btn sm pri" onClick={download} disabled={downloading}>{downloading ? '生成中…' : '⬇ PNGで保存'}</button>
      </div>
      <div className="bstudio-toolbar">
        <div className="bstudio-group">
          {LAYOUTS.map((l) => (
            <button key={l.k} className={`bstudio-chip${layout === l.k ? ' on' : ''}`} onClick={() => setLayout(l.k)}>{l.label}</button>
          ))}
        </div>
        <div className="bstudio-swatches">
          {THEMES.map((t, i) => (
            <button key={t.k} className={`bstudio-swatch${themeIdx === i ? ' on' : ''}`} style={{ background: `linear-gradient(135deg,${t.c1},${t.c2})` }}
              onClick={() => setThemeIdx(i)} aria-label={`テーマ ${t.k}`} />
          ))}
        </div>
      </div>

      <div className="bstudio-stage">
        <svg ref={svgRef} className="bstudio-svg" width={w} height={h} viewBox={`0 0 ${w} ${h}`} xmlns="http://www.w3.org/2000/svg" role="img" aria-label="自動生成バナー">
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor={theme.c1} />
              <stop offset="1" stopColor={theme.c2} />
            </linearGradient>
            <radialGradient id={`${gid}r`} cx="0.8" cy="0.15" r="0.9">
              <stop offset="0" stopColor={theme.accent} stopOpacity="0.28" />
              <stop offset="1" stopColor={theme.accent} stopOpacity="0" />
            </radialGradient>
          </defs>

          <rect width={w} height={h} fill={`url(#${gid})`} />
          <rect width={w} height={h} fill={`url(#${gid}r)`} />
          {/* 装飾: 大きな円弧 + 細い格子 */}
          <circle cx={w * 0.92} cy={h * 0.9} r={w * 0.34} fill="none" stroke={theme.accent} strokeWidth={3 * s} opacity="0.18" />
          <circle cx={w * 0.14} cy={h * 0.08} r={w * 0.16} fill={theme.accent} opacity="0.08" />
          {[0, 1, 2, 3].map((i) => (
            <circle key={i} cx={w - pad - i * 30 * s} cy={h - pad + 6 * s} r={4 * s} fill={theme.accent} opacity="0.5" />
          ))}

          {/* カラーブロック(左40%) */}
          {layout === 'block' ? <rect x="0" y="0" width={blockW} height={h} fill="#ffffff" opacity="0.06" /> : null}

          {/* ブランド */}
          <text x={brandX} y={pad + 24 * s} fill="#fff" opacity="0.92" fontSize={30 * s} fontWeight="700" fontFamily={F_BODY} textAnchor={anchor} letterSpacing={1 * s}>
            {brand || '広告主'}
          </text>
          {/* ブランド下の細いアクセント線 */}
          <rect x={centered ? w / 2 - 34 * s : brandX} y={pad + 40 * s} width={68 * s} height={4 * s} rx={2 * s} fill={theme.accent} />

          {/* 見出し */}
          {hlLines.map((ln, i) => (
            <text key={i} x={textX} y={hlTop + i * hlSize * 1.16} fill="#fff" fontSize={hlSize} fontWeight="800" fontFamily={F_DISP} textAnchor={anchor} style={{ letterSpacing: '-1px' }}>
              {ln}
            </text>
          ))}
          {/* 見出し下のアクセント下線 */}
          <rect x={centered ? w / 2 - 60 * s : textX} y={hlTop + (hlLines.length - 1) * hlSize * 1.16 + 26 * s} width={120 * s} height={6 * s} rx={3 * s} fill={theme.accent} />

          {/* 訴求 (サブ) */}
          {subLines.map((ln, i) => (
            <text key={i} x={textX} y={hlTop + hlLines.length * hlSize * 1.16 + 58 * s + i * 42 * s} fill="#fff" opacity="0.94" fontSize={32 * s} fontWeight="500" fontFamily={F_BODY} textAnchor={anchor}>
              {ln}
            </text>
          ))}

          {/* CTA ピル (矢印つき) */}
          <g transform={`translate(${centered ? (w - ctaW) / 2 : textX}, ${h - pad - 84 * s})`}>
            <rect width={ctaW} height={84 * s} rx={42 * s} fill="#ffffff" />
            <text x={44 * s} y={54 * s} fill={theme.c2} fontSize={34 * s} fontWeight="800" fontFamily={F_DISP}>{cta || '詳しくはこちら'}</text>
            <text x={ctaW - 44 * s} y={54 * s} fill={theme.c2} fontSize={34 * s} fontWeight="800" fontFamily={F_DISP} textAnchor="end">→</text>
          </g>
        </svg>
      </div>
      <p className="bstudio-note">※ 見出し・訴求・業種カラーから自動生成した下書きバナー(2倍解像度PNG)。写真は「画像/動画」から差し替え・重ね合わせできます。文字は崩れません。</p>
    </div>
  );
}
