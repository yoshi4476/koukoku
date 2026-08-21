'use client';

import { useRef, useState } from 'react';
import type { DailyPointDto } from '@adgrid/shared';
import { formatCompactYen, formatDate, formatYen } from '@/lib/format';

const W = 640;
const H = 190;
const PAD_L = 48;
const PAD_R = 16;
const PAD_T = 14;
const PAD_B = 28;

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const m = v / p;
  const nice = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10;
  return nice * p;
}

/** 日次消化額 今期 (実線) vs 前期 (破線)。ホバーでクロスヘア + ツールチップ */
export function TrendChart({ current, previous }: { current: DailyPointDto[]; previous: DailyPointDto[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [tipPos, setTipPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const n = current.length;
  if (n === 0) return null;

  const maxV = niceMax(Math.max(...current.map((p) => p.cost), ...previous.map((p) => p.cost), 1));
  const x = (i: number) => PAD_L + ((W - PAD_L - PAD_R) * i) / Math.max(n - 1, 1);
  const y = (v: number) => PAD_T + (H - PAD_T - PAD_B) * (1 - v / maxV);

  const pts = (arr: DailyPointDto[]) => arr.map((p, i) => `${x(i)},${y(p.cost)}`).join(' ');
  const last = current[n - 1];

  let area = `M${x(0)},${y(current[0]?.cost ?? 0)}`;
  current.forEach((p, i) => {
    area += ` L${x(i)},${y(p.cost)}`;
  });
  area += ` L${x(n - 1)},${y(0)} L${x(0)},${y(0)} Z`;

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((r) => r * maxV);
  const labelEvery = Math.max(1, Math.ceil(n / 8));

  const handleMove = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    const wrap = wrapRef.current;
    if (!svg || !wrap) return;
    const r = svg.getBoundingClientRect();
    const sx = ((clientX - r.left) * W) / r.width;
    let i = Math.round((sx - PAD_L) / ((W - PAD_L - PAD_R) / Math.max(n - 1, 1)));
    i = Math.max(0, Math.min(n - 1, i));
    setHover(i);
    const wr = wrap.getBoundingClientRect();
    const cx = (x(i) / W) * r.width + (r.left - wr.left);
    const cy = (y(current[i]?.cost ?? 0) / H) * r.height + (r.top - wr.top);
    setTipPos({ x: Math.min(cx + 12, wr.width - 160), y: Math.max(cy - 72, 4) });
    void clientY;
  };

  const hoverCur = hover !== null ? current[hover] : undefined;
  const hoverPrev = hover !== null ? previous[hover] : undefined;

  return (
    <div className="chart-wrap" ref={wrapRef}>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label={`日次消化額の推移。最終日は${last ? formatYen(last.cost) : '—'}`}
        onMouseMove={(e) => handleMove(e.clientX, e.clientY)}
        onMouseLeave={() => setHover(null)}
        onTouchMove={(e) => {
          const t = e.touches[0];
          if (t) handleMove(t.clientX, t.clientY);
        }}
      >
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD_L} x2={W - PAD_R} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth={1} />
            <text x={PAD_L - 8} y={y(v) + 4} textAnchor="end" fontSize={10} fill="var(--muted)">
              {v === 0 ? '0' : formatCompactYen(v)}
            </text>
          </g>
        ))}
        {current.map((p, i) =>
          i % labelEvery === 0 ? (
            <text key={p.date} x={x(i)} y={H - 8} textAnchor="middle" fontSize={10} fill="var(--muted)">
              {formatDate(p.date).replace(/\(.+\)$/, '')}
            </text>
          ) : null,
        )}
        <path d={area} fill="var(--primary)" opacity={0.08} />
        {previous.length > 1 ? (
          <polyline points={pts(previous)} fill="none" stroke="var(--muted)" strokeWidth={2} strokeDasharray="5 5" strokeLinecap="round" />
        ) : null}
        <polyline points={pts(current)} fill="none" stroke="var(--primary)" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
        {last ? (
          <>
            <circle cx={x(n - 1)} cy={y(last.cost)} r={3.5} fill="var(--primary)" />
            <text x={x(n - 1) - 6} y={y(last.cost) - 10} textAnchor="end" fontSize={11} fontWeight={700} fill="var(--ink)">
              {formatYen(last.cost)}
            </text>
          </>
        ) : null}
        {hover !== null && hoverCur ? (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={PAD_T} y2={H - PAD_B} stroke="var(--line-strong)" strokeWidth={1} />
            <circle cx={x(hover)} cy={y(hoverCur.cost)} r={4} fill="var(--primary)" stroke="var(--bg)" strokeWidth={2} />
          </>
        ) : null}
      </svg>
      <div
        className={`tooltip${hover !== null ? ' show' : ''}`}
        style={{ left: tipPos.x, top: tipPos.y }}
        aria-hidden="true"
      >
        {hoverCur ? (
          <>
            <b>{formatDate(hoverCur.date)}</b>
            <br />
            今期 {formatYen(hoverCur.cost)}
            {hoverPrev ? (
              <>
                <br />
                前期 {formatYen(hoverPrev.cost)}
                <br />
                差分 {hoverCur.cost - hoverPrev.cost >= 0 ? '+' : '−'}
                {formatYen(Math.abs(hoverCur.cost - hoverPrev.cost))}
              </>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
