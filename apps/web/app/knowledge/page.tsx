'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { KnowledgeAssetDto, KnowledgeObjective, KnowledgeSearchDto } from '@adgrid/shared';
import { INDUSTRY_BENCHMARKS } from '@adgrid/shared';
import { useApi } from '@/components/use-api';
import { EmptyState, ErrorCard, SkeletonLines } from '@/components/ui';
import { KNOWLEDGE_OBJECTIVE_LABEL, PLATFORM_SHORT_LABEL } from '@/lib/labels';
import { formatNumber, formatPercent } from '@/lib/format';

const OBJECTIVES: KnowledgeObjective[] = ['conversion', 'awareness', 'traffic'];

/** 勝率が高いカードは緑アクセント */
const HIGH_WIN_RATE = 0.6;

/** 相対リフトを符号付きで表示 */
function liftText(lift: number | null): string | null {
  if (lift === null) return null;
  const sign = lift > 0 ? '+' : '';
  return `${sign}${lift.toFixed(1)}%`;
}

function platformLabel(platform: string): string {
  return (PLATFORM_SHORT_LABEL as Record<string, string>)[platform] ?? platform;
}

/* ---- パターンカード ---- */
function AssetCard({ asset }: { asset: KnowledgeAssetDto }) {
  const hi = asset.winRate >= HIGH_WIN_RATE;
  const lift = liftText(asset.liftPct);
  return (
    <div className={`kn-card${hi ? ' hi' : ''}`}>
      <div className="kn-axis">{asset.appealAxis}</div>
      {asset.creativeSummary ? <p className="kn-summary">{asset.creativeSummary}</p> : null}
      <div className="kn-stats">
        <div className="kn-stat">
          <div className="ks-label">勝率</div>
          <div className="ks-val win num">{formatPercent(asset.winRate * 100, 0)}</div>
        </div>
        <div className="kn-stat">
          <div className="ks-label">リフト</div>
          <div className="ks-val num">{lift ?? '—'}</div>
        </div>
        <div className="kn-stat">
          <div className="ks-label">サンプル数</div>
          <div className="ks-val num">{formatNumber(asset.sampleSize)}</div>
        </div>
      </div>
      <div className="kn-tags">
        <span className="tag">{asset.industryLabel}</span>
        <span className="tag">{KNOWLEDGE_OBJECTIVE_LABEL[asset.objective]}</span>
        {asset.platform ? <span className="tag">{platformLabel(asset.platform)}</span> : null}
      </div>
    </div>
  );
}

/* ---- セクション (own / shared) ---- */
function AssetSection({
  title,
  note,
  assets,
}: {
  title: string;
  note?: string;
  assets: KnowledgeAssetDto[];
}) {
  return (
    <section className="kn-section">
      <div className="kn-section-h">
        <h2>{title}</h2>
        <span className="cnt num">{assets.length}</span>
      </div>
      {note ? <p className="kn-section-note">{note}</p> : null}
      {assets.length === 0 ? (
        <p className="kn-section-empty">該当する勝ちパターンはまだありません。</p>
      ) : (
        <div className="kn-grid">
          {assets.map((a) => (
            <AssetCard key={a.id} asset={a} />
          ))}
        </div>
      )}
    </section>
  );
}

export default function KnowledgePage() {
  const [industry, setIndustry] = useState('');
  const [objective, setObjective] = useState('');

  const path = useMemo(() => {
    const params = new URLSearchParams();
    if (industry) params.set('industryCode', industry);
    if (objective) params.set('objective', objective);
    const qs = params.toString();
    return qs ? `/knowledge?${qs}` : '/knowledge';
  }, [industry, objective]);

  const knowledge = useApi<KnowledgeSearchDto>(path);
  const own = knowledge.data?.own ?? [];
  const shared = knowledge.data?.shared ?? [];
  const isEmpty = knowledge.data !== null && own.length === 0 && shared.length === 0;

  return (
    <>
      <div className="page-h">
        <h1>勝ちパターン</h1>
        <span className="sub">A/Bで実証された訴求・クリエイティブの勝ち筋を資産化します</span>
      </div>

      <div className="kn-filters">
        <div className="field">
          <label htmlFor="kn-industry">業種</label>
          <select id="kn-industry" className="select" value={industry} onChange={(e) => setIndustry(e.target.value)}>
            <option value="">すべて</option>
            {Object.values(INDUSTRY_BENCHMARKS).map((b) => (
              <option key={b.code} value={b.code}>{b.label}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="kn-objective">目的</label>
          <select id="kn-objective" className="select" value={objective} onChange={(e) => setObjective(e.target.value)}>
            <option value="">すべて</option>
            {OBJECTIVES.map((o) => (
              <option key={o} value={o}>{KNOWLEDGE_OBJECTIVE_LABEL[o]}</option>
            ))}
          </select>
        </div>
      </div>

      {knowledge.error ? <ErrorCard error={knowledge.error} onRetry={knowledge.retry} /> : null}

      {knowledge.loading ? (
        <div className="card">
          <div className="c-body"><SkeletonLines count={5} /></div>
        </div>
      ) : null}

      {isEmpty ? (
        <EmptyState
          title="まだ勝ちパターンがありません"
          sub="A/Bテストで有意差が出たら、勝者をここに登録できます。"
          action={<Link href="/abtests" className="btn pri">A/Bテストへ</Link>}
        />
      ) : null}

      {knowledge.data && !isEmpty ? (
        <>
          <AssetSection title="自社の勝ちパターン" assets={own} />
          <AssetSection
            title="共有ナレッジ (匿名)"
            note="他社を含む匿名統計です。利用テナントが増えるほど賢くなります。"
            assets={shared}
          />
        </>
      ) : null}
    </>
  );
}
