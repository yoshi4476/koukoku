'use client';

import { use, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type {
  AssetStatus,
  AssetType,
  CreateAssetInput,
  DailyPointDto,
  ProjectAssetDto,
  ProjectDetailDto,
} from '@adgrid/shared';
import {
  ASSET_STATUS_LABEL,
  ASSET_TYPE_ICON,
  ASSET_TYPE_LABEL,
  PROJECT_GOAL_LABEL,
  PROJECT_STATUS_LABEL,
  isApprover,
} from '@adgrid/shared';
import { useApi } from '@/components/use-api';
import { useAuth } from '@/components/auth-context';
import { useClients } from '@/components/client-context';
import { DeltaText, ErrorCard, PlatformTag, SkeletonLines } from '@/components/ui';
import { apiPost, apiPut, toApiError, type ApiError } from '@/lib/api';
import { CONNECTION_STATUS_META, INDUSTRY_LABEL } from '@/lib/labels';
import { formatDate, formatNumber, formatYen } from '@/lib/format';

type Tab = 'overview' | 'delivery' | 'assets' | 'alerts' | 'improve';
const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: '概要（推移）' },
  { key: 'delivery', label: '掲示' },
  { key: 'assets', label: '制作物' },
  { key: 'alerts', label: 'アラート' },
  { key: 'improve', label: '改善' },
];

const ASSET_TYPES: AssetType[] = ['copy', 'lp', 'flyer', 'video'];
const ASSET_STATUS_CLS: Record<AssetStatus, string> = { draft: 'flat', review: 'warn', approved: 'ai', published: 'up' };
/* 次に進める状態 (公開は専用ボタン) */
const NEXT_STATUS: Partial<Record<AssetStatus, AssetStatus>> = { draft: 'review', review: 'approved' };

const STATUS_CLS: Record<string, string> = { active: 'up', paused: 'warn', ended: 'flat' };

/* コスト推移の小さな折れ線 */
function TrendChart({ points }: { points: DailyPointDto[] }) {
  if (points.length < 2) return <p style={{ color: 'var(--muted)', fontSize: 13 }}>推移データがありません。</p>;
  const w = 640, h = 140, pad = 8;
  const max = Math.max(...points.map((p) => p.cost), 1);
  const step = (w - pad * 2) / (points.length - 1);
  const y = (v: number) => h - pad - (v / max) * (h - pad * 2);
  const line = points.map((p, i) => `${pad + i * step},${y(p.cost)}`).join(' ');
  const area = `${pad},${h - pad} ${line} ${pad + (points.length - 1) * step},${h - pad}`;
  return (
    <div className="tbl-scroll">
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none" role="img" aria-label="消化額の推移">
        <polygon points={area} fill="var(--primary-soft)" />
        <polyline points={line} fill="none" stroke="var(--primary)" strokeWidth="2" strokeLinejoin="round" />
        {points.map((p, i) => (
          <circle key={p.date} cx={pad + i * step} cy={y(p.cost)} r="2.5" fill="var(--primary)">
            <title>{`${formatDate(p.date)}: ${formatYen(p.cost)} / CV ${formatNumber(p.conversions)}`}</title>
          </circle>
        ))}
      </svg>
    </div>
  );
}

function AddAssetForm({ projectId, onDone, onCancel }: { projectId: string; onDone: () => void; onCancel: () => void }) {
  const [type, setType] = useState<AssetType>('copy');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const body: CreateAssetInput = { type, title: title.trim(), content, url };
    apiPost<ProjectAssetDto>(`/projects/${projectId}/assets`, body)
      .then(() => onDone())
      .catch((err: unknown) => { setError(toApiError(err)); setBusy(false); });
  };

  return (
    <form className="card asset-form" onSubmit={submit}>
      <div className="c-body form-grid">
        {error ? <ErrorCard error={error} /> : null}
        <div className="asset-type-pick">
          {ASSET_TYPES.map((t) => (
            <button type="button" key={t} className={`asset-type-opt${type === t ? ' on' : ''}`} onClick={() => setType(t)}>
              {ASSET_TYPE_ICON[t]} {ASSET_TYPE_LABEL[t]}
            </button>
          ))}
        </div>
        <div className="field">
          <label htmlFor="as-title">タイトル</label>
          <input id="as-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder={type === 'copy' ? '例: 検索広告 見出しA' : '例: 春キャンペーンLP'} required />
        </div>
        {type === 'copy' ? (
          <div className="field">
            <label htmlFor="as-content">広告文の本文</label>
            <textarea id="as-content" className="textarea" rows={3} value={content} onChange={(e) => setContent(e.target.value)}
              placeholder="見出し・説明文を入力（AIで作る場合は「広告文」画面から）" />
          </div>
        ) : (
          <>
            <div className="field">
              <label htmlFor="as-url">{type === 'video' ? '動画のURL' : type === 'lp' ? 'LPのURL' : 'チラシ画像のURL'}</label>
              <input id="as-url" className="input" value={url} onChange={(e) => setUrl(e.target.value)}
                placeholder="https://…" />
            </div>
            <div className="field">
              <label htmlFor="as-note">説明 (任意)</label>
              <input id="as-note" className="input" value={content} onChange={(e) => setContent(e.target.value)}
                placeholder="用途・サイズなど" />
            </div>
          </>
        )}
        <div className="f-actions">
          <button type="submit" className="btn pri" disabled={busy || !title.trim()}>{busy ? '追加中…' : '制作物を追加'}</button>
          <button type="button" className="btn sec" onClick={onCancel}>キャンセル</button>
        </div>
      </div>
    </form>
  );
}

function AssetCard({ asset, canPublish, onChanged }: { asset: ProjectAssetDto; canPublish: boolean; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const advance = (status: AssetStatus) => {
    setBusy(true); setError(null);
    apiPut<ProjectAssetDto>(`/projects/assets/${asset.id}`, { status })
      .then(() => onChanged())
      .catch((e: unknown) => { setError(toApiError(e)); setBusy(false); });
  };
  const publish = () => {
    setBusy(true); setError(null);
    apiPost<ProjectAssetDto>(`/projects/assets/${asset.id}/publish`, {})
      .then(() => onChanged())
      .catch((e: unknown) => { setError(toApiError(e)); setBusy(false); });
  };
  const next = NEXT_STATUS[asset.status];

  return (
    <div className={`asset-card${asset.status === 'published' ? ' pub' : ''}`}>
      <div className="asset-head">
        <span className="asset-ico">{ASSET_TYPE_ICON[asset.type]}</span>
        <span className="asset-type">{ASSET_TYPE_LABEL[asset.type]}</span>
        <span className={`pill ${ASSET_STATUS_CLS[asset.status]}`} style={{ marginLeft: 'auto' }}>
          {ASSET_STATUS_LABEL[asset.status]}
        </span>
      </div>
      <div className="asset-title">{asset.title}</div>
      {asset.content ? <div className="asset-content">{asset.content}</div> : null}
      {asset.url ? (
        <a className="asset-url" href={asset.url} target="_blank" rel="noopener noreferrer">{asset.url} ↗</a>
      ) : null}
      {asset.publishedAt ? <div className="asset-pubdate">公開日: {formatDate(asset.publishedAt)}</div> : null}
      {error ? <div style={{ fontSize: 11.5, color: 'var(--bad)' }}>{error.message}</div> : null}
      <div className="asset-actions">
        {next ? (
          <button className="btn sm sec" disabled={busy} onClick={() => advance(next)}>
            {next === 'review' ? 'レビューへ' : '承認する'}
          </button>
        ) : null}
        {asset.status !== 'published' && canPublish ? (
          <button className="btn sm pri" disabled={busy} onClick={publish}>🚀 公開する</button>
        ) : null}
        {asset.status === 'published' && canPublish ? (
          <button className="btn sm sec" disabled={busy} onClick={() => advance('approved')}>公開を停止</button>
        ) : null}
      </div>
    </div>
  );
}

function AssetsTab({ project, onChanged }: { project: ProjectDetailDto; onChanged: () => void }) {
  const { me } = useAuth();
  const [showForm, setShowForm] = useState(false);
  const canPublish = me.edition === 'agency' && isApprover(me.role);
  const assets = project.assets;

  return (
    <div className="card">
      <div className="c-head">
        <h2>制作物（広告文・LP・チラシ・動画）</h2>
        <button className="btn sm pri" style={{ marginLeft: 'auto' }} onClick={() => setShowForm((v) => !v)}>
          {showForm ? '閉じる' : '＋ 制作物を追加'}
        </button>
      </div>
      <div className="c-body">
        {showForm ? <AddAssetForm projectId={project.id} onDone={() => { setShowForm(false); onChanged(); }} onCancel={() => setShowForm(false)} /> : null}
        {assets.length === 0 && !showForm ? (
          <p style={{ margin: 0, color: 'var(--muted)' }}>
            まだ制作物がありません。「＋ 制作物を追加」から広告文・LP・チラシ・動画を登録し、<mark>下書き → レビュー → 承認 → 公開</mark>まで進められます。
          </p>
        ) : null}
        {assets.length > 0 ? (
          <div className="asset-grid">
            {assets.map((a) => <AssetCard key={a.id} asset={a} canPublish={canPublish} onChanged={onChanged} />)}
          </div>
        ) : null}
        {!canPublish && assets.length > 0 ? (
          <p style={{ marginTop: 12, fontSize: 12, color: 'var(--muted)' }}>
            ※ 公開は自社運用版のオーナー / 管理者のみ行えます。
          </p>
        ) : null}
      </div>
    </div>
  );
}

export default function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { setSelectedClientId } = useClients();
  const detail = useApi<ProjectDetailDto>(`/projects/${id}`);
  const [tab, setTab] = useState<Tab>('overview');
  const d = detail.data;

  const kpiCards = useMemo(() => {
    if (!d) return [];
    const k = d.kpi;
    return [
      { label: '消化額 (7日)', value: formatYen(k.cost), delta: k.deltas.cost, invert: true },
      { label: 'CV', value: formatNumber(k.conversions), delta: k.deltas.conversions, invert: false },
      { label: 'CPA', value: formatYen(k.cpa), delta: k.deltas.cpa, invert: true },
      { label: 'ROAS', value: k.roas === null ? '—' : `${Math.round(k.roas)}%`, delta: k.deltas.roas, invert: false },
    ];
  }, [d]);

  /* 改善アクション: クライアント文脈を合わせて各画面へ */
  const goFiltered = (href: string) => {
    if (d) setSelectedClientId(d.clientId);
    router.push(href);
  };

  return (
    <>
      <div className="page-h">
        <Link href="/projects" className="btn sm sec">← プロジェクト一覧</Link>
        <h1 style={{ marginLeft: 4 }}>{d ? d.name : 'プロジェクト'}</h1>
        {d ? <span className={`pill ${STATUS_CLS[d.status] ?? 'flat'}`}>{PROJECT_STATUS_LABEL[d.status]}</span> : null}
      </div>

      {detail.error ? <ErrorCard error={detail.error} onRetry={detail.retry} /> : null}
      {detail.loading ? <div className="card"><div className="c-body"><SkeletonLines count={5} /></div></div> : null}

      {d ? (
        <>
          <div className="proj-meta">
            <span>🏢 {d.clientName}</span>
            <span className="proj-ind">{INDUSTRY_LABEL[d.industryCode] ?? d.industryCode}</span>
            <span>🎯 {PROJECT_GOAL_LABEL[d.goal]}</span>
            <span>📺 媒体{d.accounts.length}件</span>
            {d.note ? <span className="proj-note">{d.note}</span> : null}
          </div>

          <div className="tabs proj-tabs">
            {TABS.map((t) => (
              <button key={t.key} className={`tab ${tab === t.key ? 'on' : ''}`} onClick={() => setTab(t.key)}>
                {t.label}
                {t.key === 'assets' && d.assets.length > 0 ? <span className="wtab-count">{d.assets.length}</span> : null}
                {t.key === 'alerts' && d.alerts.length > 0 ? <span className="wtab-count">{d.alerts.length}</span> : null}
                {t.key === 'improve' && d.openFindings > 0 ? <span className="wtab-count">{d.openFindings}</span> : null}
              </button>
            ))}
          </div>

          {/* --- 概要（推移） --- */}
          {tab === 'overview' ? (
            <>
              <div className="kpis">
                {kpiCards.map((c) => (
                  <div className="kpi" key={c.label}>
                    <div className="k-label">{c.label}</div>
                    <div className="k-val">{c.value}</div>
                    <div className="k-foot"><DeltaText value={c.delta} invert={c.invert} /></div>
                  </div>
                ))}
              </div>
              <div className="card">
                <div className="c-head"><h2>消化額の推移 (直近14日)</h2>
                  <button className="btn sm sec" style={{ marginLeft: 'auto' }} onClick={() => goFiltered('/dashboard')}>詳しいダッシュボードへ</button>
                </div>
                <div className="c-body"><TrendChart points={d.trend} /></div>
              </div>
            </>
          ) : null}

          {/* --- 掲示 --- */}
          {tab === 'delivery' ? (
            <div className="card">
              <div className="c-head"><h2>掲示（配信中の媒体）</h2>
                <button className="btn sm sec" style={{ marginLeft: 'auto' }} onClick={() => goFiltered('/connections')}>媒体接続を管理</button>
              </div>
              <div className="c-body tbl-scroll" style={{ padding: 0 }}>
                <table className="data-tbl">
                  <thead><tr><th>媒体アカウント</th><th>接続</th><th>月予算</th><th>消化(7日)</th><th>CV</th><th>CPA</th></tr></thead>
                  <tbody>
                    {d.accounts.map((a) => {
                      const cs = CONNECTION_STATUS_META[a.connectionStatus];
                      return (
                        <tr key={a.adAccountId}>
                          <td><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><PlatformTag platform={a.platform} /><span>{a.name}</span></div></td>
                          <td><span className="pill" style={{ background: 'var(--bg-sub)', color: cs.colorVar }}>{cs.label}</span></td>
                          <td>{formatYen(a.monthlyBudget)}</td>
                          <td>{formatYen(a.cost7d)}</td>
                          <td>{formatNumber(a.conversions7d)}</td>
                          <td>{formatYen(a.cpa7d)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          {/* --- 制作物 --- */}
          {tab === 'assets' ? <AssetsTab project={d} onChanged={detail.retry} /> : null}

          {/* --- アラート --- */}
          {tab === 'alerts' ? (
            <div className="card">
              <div className="c-head"><h2>このプロジェクトのアラート</h2>
                <button className="btn sm sec" style={{ marginLeft: 'auto' }} onClick={() => goFiltered('/alerts')}>アラート設定へ</button>
              </div>
              <div className="c-body">
                {d.alerts.length === 0 ? (
                  <p style={{ margin: 0, color: 'var(--good)', fontWeight: 600 }}>✓ 対応が必要なアラートはありません。</p>
                ) : (
                  <div className="proj-alerts">
                    {d.alerts.map((e) => (
                      <div key={e.id} className={`proj-alert ${e.severity}`}>
                        <div className="pa-title">{e.title}</div>
                        <div className="pa-body">{e.accountName}: {e.body.replace(`${e.accountName}: `, '')}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : null}

          {/* --- 改善 --- */}
          {tab === 'improve' ? (
            <div className="card">
              <div className="c-head"><h2>改善する</h2></div>
              <div className="c-body form-grid">
                <p style={{ margin: 0, fontSize: 14, color: 'var(--ink-2)' }}>
                  未対応の改善提案は <b className="num" style={{ color: d.openFindings > 0 ? 'var(--warn)' : 'var(--good)' }}>{d.openFindings}件</b> です。
                  下のボタンから、このプロジェクトの改善作業に進めます。
                </p>
                <div className="proj-actions">
                  <button className="btn pri" onClick={() => goFiltered('/audit')}>🩺 AI診断で改善点を見る</button>
                  <button className="btn sec" onClick={() => goFiltered('/keywords')}>🔍 キーワード最適化</button>
                  <button className="btn sec" onClick={() => goFiltered('/approvals')}>✅ 承認キュー</button>
                  <button className="btn sec" onClick={() => goFiltered('/report')}>📄 レポートを作成</button>
                </div>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </>
  );
}
