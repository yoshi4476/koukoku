'use client';

import { use, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type {
  AssetAdviceDto,
  AssetStatus,
  AssetType,
  BidStrategy,
  BudgetPlanDto,
  CreateAssetInput,
  DailyPointDto,
  FatigueReportDto,
  ProjectAssetDto,
  ProjectBrief,
  ProjectDetailDto,
  ProjectSettings,
  ReviewSimDto,
} from '@adgrid/shared';
import {
  ASSET_STATUS_LABEL,
  ASSET_TYPE_ICON,
  ASSET_TYPE_LABEL,
  BID_STRATEGY_LABEL,
  PACE_STATUS_LABEL,
  PROJECT_GOAL_LABEL,
  PROJECT_STATUS_LABEL,
  REVIEW_VERDICT_META,
  briefCompleteness,
  industryProfileFor,
  isApprover,
  recommendMediaPlan,
  relevantAssetTypes,
} from '@adgrid/shared';
import { useApi } from '@/components/use-api';
import { useAuth } from '@/components/auth-context';
import { useClients } from '@/components/client-context';
import { DeltaText, ErrorCard, Modal, PlatformTag, SkeletonLines } from '@/components/ui';
import { apiDelete, apiGet, apiPost, apiPut, apiUpload, mediaUrl, toApiError, type ApiError } from '@/lib/api';
import { AdPreview, PublishConfirm } from './ad-preview';
import { CreativeGenerator } from './creative-gen';
import { OpsCycleTab } from './ops-cycle';
import { FunnelBox } from './funnel-box';
import { PreflightPanel } from './preflight-panel';
import { CONNECTION_STATUS_META, INDUSTRY_LABEL } from '@/lib/labels';
import { formatDate, formatNumber, formatYen } from '@/lib/format';

type Tab = 'cycle' | 'overview' | 'hearing' | 'delivery' | 'settings' | 'assets' | 'alerts' | 'improve';
const TABS: { key: Tab; label: string }[] = [
  { key: 'cycle', label: '🔄 運用サイクル' },
  { key: 'overview', label: '概要（推移）' },
  { key: 'hearing', label: 'ヒアリング' },
  { key: 'delivery', label: '掲示' },
  { key: 'settings', label: '配信設定' },
  { key: 'assets', label: '制作物' },
  { key: 'alerts', label: 'アラート' },
  { key: 'improve', label: '改善' },
];

const BRIEF_FIELDS: { key: keyof ProjectBrief; label: string; ph: string; long?: boolean }[] = [
  { key: 'business', label: '事業内容', ph: '例: 都内で美容脱毛クリニックを3院運営' },
  { key: 'product', label: '商材・サービスの内容', ph: '例: 医療脱毛5回コース / 都度払いプラン' },
  { key: 'usp', label: '強み・他社との違い (USP)', ph: '例: 完全個室・当日予約可・医師常駐・追加料金なし', long: true },
  { key: 'targetPersona', label: 'ターゲット顧客像', ph: '例: 20-34歳女性、初めての脱毛で痛みと料金が不安', long: true },
  { key: 'painPoint', label: '顧客の悩み・課題', ph: '例: 他院は追加料金が不明瞭・予約が取れない', long: true },
  { key: 'offer', label: '特典・オファー・保証', ph: '例: 初回カウンセリング無料・のりかえ割20%OFF' },
  { key: 'reasonToChoose', label: '選ばれる理由・実績', ph: '例: 累計10万件・満足度98%・口コミ★4.7' },
  { key: 'competitors', label: '競合', ph: '例: A院(価格訴求)・B院(店舗数)' },
  { key: 'area', label: '提供エリア', ph: '例: 新宿・渋谷・池袋' },
  { key: 'ngItems', label: 'NG・言えないこと・規制', ph: '例: 効果を断定する表現はNG(医療広告ガイドライン)' },
  { key: 'reference', label: '参考LP・事例URL', ph: 'https://…' },
  { key: 'note', label: 'その他・補足', ph: '' },
];

const BID_STRATEGIES: BidStrategy[] = ['maximize_conversions', 'target_cpa', 'target_roas', 'maximize_clicks', 'manual'];
const ADVICE_ICON: Record<string, string> = { good: '✅', tip: '💡', warn: '⚠️' };

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

/* 数値入力を number|null に変換 */
function numOrNull(v: string): number | null {
  const n = Number(v.replace(/,/g, ''));
  return v.trim() === '' || Number.isNaN(n) ? null : n;
}

function HearingTab({ project, onSaved }: { project: ProjectDetailDto; onSaved: () => void }) {
  const { me } = useAuth();
  const router = useRouter();
  const { setSelectedClientId } = useClients();
  const canEdit = me.edition === 'agency';
  const [b, setB] = useState<ProjectBrief>(project.brief);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const set = (k: keyof ProjectBrief, v: string) => { setB((p) => ({ ...p, [k]: v })); setSaved(false); };

  const comp = useMemo(() => briefCompleteness(b), [b]);
  const profile = industryProfileFor(project.industryCode);

  const draft = useMemo(() => {
    const lines: string[] = [];
    if (b.painPoint.trim()) lines.push(`【共感】${b.painPoint.trim()} ——そのお悩み、解決できます`);
    if (b.usp.trim()) lines.push(`【強み】${b.usp.trim()}`);
    if (b.reasonToChoose.trim()) lines.push(`【実績】${b.reasonToChoose.trim()}`);
    if (b.offer.trim()) lines.push(`【今なら】${b.offer.trim()}`);
    lines.push(`【訴求軸(業種)】${profile.appealAxes.slice(0, 3).join(' / ')}`);
    lines.push(`【行動】${profile.cvLabel}はこちら`);
    return lines;
  }, [b, profile]);

  const save = () => {
    setBusy(true); setError(null);
    apiPut(`/projects/${project.id}`, { brief: b })
      .then(() => { setSaved(true); onSaved(); })
      .catch((e: unknown) => setError(toApiError(e)))
      .finally(() => setBusy(false));
  };
  const makeCopy = () => { setSelectedClientId(project.clientId); router.push('/copy'); };

  const compCls = comp.pct >= 100 ? 'up' : comp.pct >= 60 ? 'warn' : 'down';

  return (
    <div className="card">
      <div className="c-head">
        <h2>ヒアリングシート</h2>
        <span className={`pill ${compCls}`} style={{ marginLeft: 'auto' }}>記入率 {comp.pct}%</span>
      </div>
      <div className="c-body form-grid">
        {error ? <ErrorCard error={error} /> : null}
        <div className="hear-meter">
          <div className="hear-bar"><div className={`hear-fill ${compCls}`} style={{ width: `${comp.pct}%` }} /></div>
          <p className="hear-hint">
            {comp.pct >= 100
              ? '✅ 主要項目がすべて埋まりました。この内容から精度の高い広告文・打ち出し方が作れます。'
              : `あと${comp.missing.length}項目でフル活用できます。しっかり記入するほど、成果の出る広告になります。`}
          </p>
        </div>

        {BRIEF_FIELDS.map((f) => (
          <div className="field" key={f.key}>
            <label htmlFor={`br-${f.key}`}>
              {f.label}
              {(['business', 'product', 'usp', 'targetPersona', 'painPoint', 'offer', 'reasonToChoose'] as (keyof ProjectBrief)[]).includes(f.key)
                ? <span className="hear-req">重要</span> : null}
            </label>
            {f.long ? (
              <textarea id={`br-${f.key}`} className="textarea" rows={2} value={b[f.key]} disabled={!canEdit}
                onChange={(e) => set(f.key, e.target.value)} placeholder={f.ph} />
            ) : (
              <input id={`br-${f.key}`} className="input" value={b[f.key]} disabled={!canEdit}
                onChange={(e) => set(f.key, e.target.value)} placeholder={f.ph} />
            )}
          </div>
        ))}

        {canEdit ? (
          <div className="f-actions">
            <button className="btn pri" disabled={busy} onClick={save}>{busy ? '保存中…' : 'ヒアリングを保存'}</button>
            {saved ? <span style={{ color: 'var(--good)', fontWeight: 600, fontSize: 13 }}>✓ 保存しました</span> : null}
          </div>
        ) : <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)' }}>※ 提供先版では閲覧のみです。</p>}

        {/* ヒアリングから訴求ドラフトを自動生成 */}
        <div className="hear-draft">
          <div className="hear-draft-h">🪄 ヒアリングから作る「訴求の型」</div>
          <div className="hear-draft-body">
            {draft.map((l, i) => <div key={i} className="hear-draft-line">{l}</div>)}
          </div>
          <p className="hear-draft-note">この型をベースに広告文を作ると、{profile.label}で成果が出やすくなります。</p>
          <button className="btn sm pri" onClick={makeCopy}>この内容で広告文を作る →</button>
        </div>
      </div>
    </div>
  );
}

function MediaPlanBox({ project, onApply }: { project: ProjectDetailDto; onApply: (patch: Partial<ProjectSettings>) => void }) {
  const router = useRouter();
  const { setSelectedClientId } = useClients();
  const [open, setOpen] = useState(false);
  const [budget, setBudget] = useState<number>(project.settings.monthlyBudgetTotal ?? 1000000);
  const plan = useMemo(() => recommendMediaPlan(project.industryCode, project.goal, budget), [project.industryCode, project.goal, budget]);

  const apply = () => {
    onApply({
      monthlyBudgetTotal: budget,
      dailyBudget: Math.round(budget / 30),
      targetCpa: plan.targetCpa,
      targetRoas: plan.targetRoas,
      bidStrategy: plan.bidStrategy,
      regions: plan.targeting.regions,
      ageRange: plan.targeting.ageRange,
      gender: plan.targeting.gender,
      devices: plan.targeting.devices,
      conversionPoint: plan.conversionPoint,
    });
  };
  const makeCopy = () => { setSelectedClientId(project.clientId); router.push('/copy'); };

  return (
    <div className="plan-box">
      <div className="plan-head">
        <div>
          <div className="plan-title">🤖 最適な打ち出し方を提案</div>
          <div className="plan-sub">{plan.industryLabel}・{plan.goalLabel}の一般的な最適解を、予算から自動で組み立てます。</div>
        </div>
        <button type="button" className="btn sm sec" onClick={() => setOpen((v) => !v)}>{open ? '閉じる' : '提案を見る'}</button>
      </div>
      {open ? (
        <div className="plan-body">
          <div className="plan-budget">
            <label>月予算</label>
            <input className="input" inputMode="numeric" value={budget || ''}
              onChange={(e) => setBudget(Number(e.target.value.replace(/[^0-9]/g, '')) || 0)} style={{ maxWidth: 160 }} />
            <span className="plan-est">→ 目標CPA <b>{formatYen(plan.targetCpa)}</b> ・ 想定CV <b>{formatNumber(plan.expectedCv)}件/月</b></span>
          </div>
          <div className="plan-media">
            {plan.media.map((m) => (
              <div className="plan-media-card" key={m.platform}>
                <div className="plan-media-row">
                  <PlatformTag platform={m.platform} />
                  <span className="plan-format">{m.format}</span>
                  <div className="plan-bar"><div className="plan-bar-fill" style={{ width: `${m.sharePct}%` }} /></div>
                  <span className="plan-share num">{m.sharePct}%</span>
                  <span className="plan-amt num">{formatYen(m.monthlyBudget)}</span>
                </div>
                <div className="plan-playbook">📋 {m.playbook}</div>
              </div>
            ))}
          </div>
          <div className="plan-meta">
            <div><span className="pm-l">推奨する訴求</span> {plan.appealAxes.slice(0, 4).map((a) => <span key={a} className="ind-chip pri">{a}</span>)}</div>
            <div><span className="pm-l">ターゲット</span> {plan.targeting.regions}・{plan.targeting.ageRange}・{plan.targeting.gender === 'female' ? '女性' : plan.targeting.gender === 'male' ? '男性' : '男女'}・{plan.targeting.devices === 'mobile' ? 'スマホ中心' : plan.targeting.devices === 'desktop' ? 'PC中心' : '全デバイス'}</div>
            <div><span className="pm-l">計測CV地点</span> {plan.conversionPoint}</div>
          </div>
          <p className="plan-note">💡 {plan.note}</p>
          <div className="f-actions">
            <button type="button" className="btn pri" onClick={apply}>この内容を下の設定に反映</button>
            <button type="button" className="btn sec" onClick={makeCopy}>この訴求で広告文を作る →</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SettingsTab({ project, onSaved }: { project: ProjectDetailDto; onSaved: () => void }) {
  const { me } = useAuth();
  const canEdit = me.edition === 'agency';
  const [s, setS] = useState<ProjectSettings>(project.settings);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const set = <K extends keyof ProjectSettings>(k: K, v: ProjectSettings[K]) => { setS((p) => ({ ...p, [k]: v })); setSaved(false); };
  const applyPlan = (patch: Partial<ProjectSettings>) => { setS((p) => ({ ...p, ...patch })); setSaved(false); };

  const save = () => {
    setBusy(true); setError(null);
    apiPut(`/projects/${project.id}`, { settings: s })
      .then(() => { setSaved(true); onSaved(); })
      .catch((e: unknown) => setError(toApiError(e)))
      .finally(() => setBusy(false));
  };

  return (
    <div className="card">
      <div className="c-head"><h2>配信設定（金額・入札・ターゲティング）</h2></div>
      <div className="c-body form-grid">
        {error ? <ErrorCard error={error} /> : null}

        <FunnelBox industryCode={project.industryCode} goal={project.goal} />

        {canEdit ? <MediaPlanBox project={project} onApply={applyPlan} /> : null}

        <div className="set-group">💴 予算・目標</div>
        <div className="set-row">
          <div className="field"><label>月予算 合計 (円)</label>
            <input className="input" inputMode="numeric" value={s.monthlyBudgetTotal ?? ''} disabled={!canEdit}
              onChange={(e) => set('monthlyBudgetTotal', numOrNull(e.target.value))} placeholder="例: 1600000" /></div>
          <div className="field"><label>日予算の目安 (円)</label>
            <input className="input" inputMode="numeric" value={s.dailyBudget ?? ''} disabled={!canEdit}
              onChange={(e) => set('dailyBudget', numOrNull(e.target.value))} placeholder="例: 53000" /></div>
        </div>
        <div className="set-row">
          <div className="field"><label>目標CPA (円)</label>
            <input className="input" inputMode="numeric" value={s.targetCpa ?? ''} disabled={!canEdit}
              onChange={(e) => set('targetCpa', numOrNull(e.target.value))} placeholder="例: 4000" /></div>
          <div className="field"><label>目標ROAS (%)</label>
            <input className="input" inputMode="numeric" value={s.targetRoas ?? ''} disabled={!canEdit}
              onChange={(e) => set('targetRoas', numOrNull(e.target.value))} placeholder="例: 400" /></div>
        </div>
        <div className="field"><label>目標CV数 (件/月)</label>
          <input className="input" inputMode="numeric" value={s.targetCv ?? ''} disabled={!canEdit}
            onChange={(e) => set('targetCv', numOrNull(e.target.value))} placeholder="例: 260 — 概要タブで達成ペースを表示" /></div>
        <div className="field"><label>入札戦略</label>
          <select className="select" value={s.bidStrategy} disabled={!canEdit} onChange={(e) => set('bidStrategy', e.target.value as BidStrategy)}>
            {BID_STRATEGIES.map((b) => <option key={b} value={b}>{BID_STRATEGY_LABEL[b]}</option>)}
          </select></div>

        <div className="set-group">🎯 ターゲティング</div>
        <div className="set-row">
          <div className="field"><label>対象地域</label>
            <input className="input" value={s.regions} disabled={!canEdit} onChange={(e) => set('regions', e.target.value)} placeholder="例: 全国 / 東京・神奈川" /></div>
          <div className="field"><label>年齢層</label>
            <input className="input" value={s.ageRange} disabled={!canEdit} onChange={(e) => set('ageRange', e.target.value)} placeholder="例: 25-44" /></div>
        </div>
        <div className="set-row">
          <div className="field"><label>性別</label>
            <select className="select" value={s.gender} disabled={!canEdit} onChange={(e) => set('gender', e.target.value as ProjectSettings['gender'])}>
              <option value="all">すべて</option><option value="female">女性</option><option value="male">男性</option>
            </select></div>
          <div className="field"><label>デバイス</label>
            <select className="select" value={s.devices} disabled={!canEdit} onChange={(e) => set('devices', e.target.value as ProjectSettings['devices'])}>
              <option value="all">すべて</option><option value="mobile">スマホ中心</option><option value="desktop">PC中心</option>
            </select></div>
        </div>

        <div className="set-group">📅 期間・計測</div>
        <div className="set-row">
          <div className="field"><label>配信開始日</label>
            <input type="date" className="input" value={s.startDate ?? ''} disabled={!canEdit} onChange={(e) => set('startDate', e.target.value || null)} /></div>
          <div className="field"><label>配信終了日 (無期限は空欄)</label>
            <input type="date" className="input" value={s.endDate ?? ''} disabled={!canEdit} onChange={(e) => set('endDate', e.target.value || null)} /></div>
        </div>
        <div className="set-row">
          <div className="field"><label>計測するCV地点</label>
            <input className="input" value={s.conversionPoint} disabled={!canEdit} onChange={(e) => set('conversionPoint', e.target.value)} placeholder="例: 購入完了 / 資料請求" /></div>
          <div className="field"><label>配信時間帯</label>
            <input className="input" value={s.dayparting} disabled={!canEdit} onChange={(e) => set('dayparting', e.target.value)} placeholder="例: 終日 / 平日9-18時" /></div>
        </div>
        <div className="field"><label>メモ</label>
          <textarea className="textarea" rows={2} value={s.note} disabled={!canEdit} onChange={(e) => set('note', e.target.value)} placeholder="運用上の申し送りなど" /></div>

        {canEdit ? (
          <div className="f-actions">
            <button className="btn pri" disabled={busy} onClick={save}>{busy ? '保存中…' : '設定を保存'}</button>
            {saved ? <span style={{ color: 'var(--good)', fontWeight: 600, fontSize: 13 }}>✓ 保存しました</span> : null}
          </div>
        ) : (
          <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)' }}>※ 提供先版では閲覧のみです。</p>
        )}
      </div>
    </div>
  );
}

function AssetAdvice({ assetId }: { assetId: string }) {
  const [open, setOpen] = useState(false);
  const [advice, setAdvice] = useState<AssetAdviceDto | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (advice) return;
    setBusy(true);
    apiGet<AssetAdviceDto>(`/projects/assets/${assetId}/advice`)
      .then(setAdvice)
      .catch(() => setAdvice(null))
      .finally(() => setBusy(false));
  };

  return (
    <div className="asset-advice-wrap">
      <button className="btn sm sec" onClick={load}>{open ? '改善ポイントを閉じる' : '💡 改善ポイントを見る'}</button>
      {open ? (
        <div className="asset-advice">
          {busy ? <SkeletonLines count={2} /> : advice ? (
            <>
              <p className="aa-summary">{advice.summary}</p>
              <ul className="aa-list">
                {advice.items.map((it, i) => (
                  <li key={i} className={`aa-item ${it.severity}`}>
                    <span className="aa-ico">{ADVICE_ICON[it.severity]}</span>
                    <span><b>{it.title}</b><br /><span className="aa-detail">{it.detail}</span></span>
                  </li>
                ))}
              </ul>
            </>
          ) : <p style={{ color: 'var(--muted)', fontSize: 12.5 }}>改善ポイントを取得できませんでした。</p>}
        </div>
      ) : null}
    </div>
  );
}

function ReviewSim({ assetId }: { assetId: string }) {
  const [open, setOpen] = useState(false);
  const [rev, setRev] = useState<ReviewSimDto | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => {
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (rev) return;
    setBusy(true);
    apiGet<ReviewSimDto>(`/projects/assets/${assetId}/review`).then(setRev).catch(() => setRev(null)).finally(() => setBusy(false));
  };
  const m = rev ? REVIEW_VERDICT_META[rev.verdict] : null;
  return (
    <div className="asset-advice-wrap">
      <button className="btn sm sec" onClick={load}>{open ? '審査チェックを閉じる' : '🛡️ 審査シミュレーション'}</button>
      {open ? (
        <div className="asset-advice">
          {busy ? <SkeletonLines count={1} /> : rev ? (
            <>
              <p className="aa-summary"><span className={`pill ${m!.cls}`}>{m!.label}</span> {rev.note}</p>
              {rev.issues.length > 0 ? (
                <ul className="aa-list">
                  {rev.issues.map((it, i) => (
                    <li key={i} className={`aa-item ${it.severity === 'block' ? 'warn' : ''}`}>
                      <span className="aa-ico">{it.severity === 'block' ? '⛔' : '⚠️'}</span>
                      <span><b>{it.scope}: 「{it.expression}」</b><br /><span className="aa-detail">{it.reason} → {it.suggestion}</span></span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : <p style={{ color: 'var(--muted)', fontSize: 12.5 }}>審査チェックを取得できませんでした。</p>}
        </div>
      ) : null}
    </div>
  );
}

function AddAssetForm({ projectId, types, onDone, onCancel }: { projectId: string; types: AssetType[]; onDone: () => void; onCancel: () => void }) {
  const [type, setType] = useState<AssetType>(types[0] ?? 'copy');
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
          {types.map((t) => (
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
              <label htmlFor="as-url">{type === 'lp' ? 'LPのURL' : 'チラシ画像のURL'}</label>
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

const isVideoUrl = (url: string) => /\.(mp4|mov|webm)$/i.test(url);

function AssetCard({ asset, project, canPublish, canEdit, onChanged }: {
  asset: ProjectAssetDto; project: ProjectDetailDto; canPublish: boolean; canEdit: boolean; onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pubError, setPubError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const remove = () => {
    setBusy(true); setError(null);
    apiDelete(`/projects/assets/${asset.id}`)
      .then(() => onChanged())
      .catch((e: unknown) => { setError(toApiError(e)); setBusy(false); });
  };

  const advance = (status: AssetStatus) => {
    setBusy(true); setError(null);
    apiPut<ProjectAssetDto>(`/projects/assets/${asset.id}`, { status })
      .then(() => onChanged())
      .catch((e: unknown) => setError(toApiError(e)))
      .finally(() => setBusy(false));
  };
  const doPublish = () => {
    setBusy(true); setPubError(null);
    apiPost<ProjectAssetDto>(`/projects/assets/${asset.id}/publish`, {})
      .then(() => { setShowConfirm(false); onChanged(); })
      .catch((e: unknown) => setPubError(toApiError(e).message))
      .finally(() => setBusy(false));
  };
  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    setBusy(true); setError(null);
    apiUpload<ProjectAssetDto>(`/projects/assets/${asset.id}/upload`, form)
      .then(() => onChanged())
      .catch((err: unknown) => setError(toApiError(err)))
      .finally(() => { setBusy(false); if (fileRef.current) fileRef.current.value = ''; });
  };
  const next = NEXT_STATUS[asset.status];
  const media = asset.url ? mediaUrl(asset.url) : '';
  const uploaded = asset.url.startsWith('/uploads/');

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
      {media ? (
        isVideoUrl(asset.url)
          ? <video className="asset-thumb" src={media} controls preload="metadata" />
          : <img className="asset-thumb" src={media} alt={asset.title} />
      ) : null}
      {asset.url && !uploaded ? (
        <a className="asset-url" href={asset.url} target="_blank" rel="noopener noreferrer">{asset.url} ↗</a>
      ) : null}
      {asset.publishedAt ? <div className="asset-pubdate">公開日: {formatDate(asset.publishedAt)}</div> : null}
      {error ? <div style={{ fontSize: 11.5, color: 'var(--bad)' }}>{error.message}</div> : null}
      <div className="asset-actions">
        <button className="btn sm sec" disabled={busy} onClick={() => setShowPreview(true)}>👁 プレビュー</button>
        {canEdit ? (
          <>
            <button className="btn sm sec" disabled={busy} onClick={() => fileRef.current?.click()}>
              🖼 {uploaded ? '差し替え' : '画像/動画'}
            </button>
            <input ref={fileRef} type="file" accept="image/*,video/*" style={{ display: 'none' }} onChange={onFile} />
          </>
        ) : null}
        {next && canEdit ? (
          <button className="btn sm sec" disabled={busy} onClick={() => advance(next)}>
            {next === 'review' ? 'レビューへ' : '承認する'}
          </button>
        ) : null}
        {asset.status !== 'published' && canPublish ? (
          <button className="btn sm pri" disabled={busy} onClick={() => { setPubError(null); setShowConfirm(true); }}>🚀 公開する</button>
        ) : null}
        {asset.status === 'published' && canPublish ? (
          <button className="btn sm sec" disabled={busy} onClick={() => advance('approved')}>公開を停止</button>
        ) : null}
        {canEdit && asset.status !== 'published' ? (
          confirmDelete ? (
            <span className="asset-del-confirm">
              削除しますか?
              <button className="btn sm danger" disabled={busy} onClick={remove}>削除</button>
              <button className="btn sm sec" disabled={busy} onClick={() => setConfirmDelete(false)}>やめる</button>
            </span>
          ) : (
            <button className="btn sm sec danger-text" disabled={busy} onClick={() => setConfirmDelete(true)}>🗑 削除</button>
          )
        ) : null}
      </div>
      <AssetAdvice assetId={asset.id} />
      <ReviewSim assetId={asset.id} />

      {showPreview ? (
        <Modal title={`広告プレビュー — ${asset.title}`} onClose={() => setShowPreview(false)}>
          <AdPreview asset={asset} project={project} showBanner onAssetChanged={onChanged} />
        </Modal>
      ) : null}
      {showConfirm ? (
        <Modal title="公開前の最終確認" onClose={() => (busy ? undefined : setShowConfirm(false))} wide>
          <PublishConfirm
            project={project}
            asset={asset}
            busy={busy}
            error={pubError}
            onConfirm={doPublish}
            onCancel={() => setShowConfirm(false)}
          />
        </Modal>
      ) : null}
    </div>
  );
}

function AssetsTab({ project, onChanged }: { project: ProjectDetailDto; onChanged: () => void }) {
  const { me } = useAuth();
  const [showForm, setShowForm] = useState(false);
  const [showGen, setShowGen] = useState(false);
  const [showPreflight, setShowPreflight] = useState(false);
  const canPublish = me.edition === 'agency' && isApprover(me.role);
  const canEdit = me.edition === 'agency';
  const assets = project.assets;
  // この広告(媒体構成・目的)に必要な制作物カテゴリだけを見出し/追加フォームに出す
  const fitTypes = relevantAssetTypes(project.accounts.map((a) => a.platform), project.goal);
  const fitLabel = fitTypes.map((t) => ASSET_TYPE_LABEL[t].replace(' (ランディングページ)', '')).join('・');

  return (
    <div className="card">
      <div className="c-head">
        <h2>制作物（{fitLabel}）</h2>
        {canEdit ? (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button className="btn sm sec" onClick={() => setShowPreflight(true)}>🔍 公開前チェック</button>
            <button className="btn sm ai" onClick={() => setShowGen(true)}>🎨 業種に合わせてAIで作成</button>
            <button className="btn sm pri" onClick={() => setShowForm((v) => !v)}>
              {showForm ? '閉じる' : '＋ 制作物を追加'}
            </button>
          </div>
        ) : null}
      </div>
      <div className="c-body">
        {showPreflight ? (
          <Modal title="🔍 公開前チェック" onClose={() => setShowPreflight(false)} wide>
            <PreflightPanel projectId={project.id} onChanged={onChanged} />
          </Modal>
        ) : null}
        {showGen ? (
          <Modal title="🎨 業種に合わせてAIでクリエイティブ作成" onClose={() => setShowGen(false)} wide>
            <CreativeGenerator projectId={project.id} onAdopted={onChanged} onClose={() => setShowGen(false)} />
          </Modal>
        ) : null}
        {showForm ? <AddAssetForm projectId={project.id} types={fitTypes} onDone={() => { setShowForm(false); onChanged(); }} onCancel={() => setShowForm(false)} /> : null}
        {assets.length === 0 && !showForm ? (
          <p style={{ margin: 0, color: 'var(--muted)' }}>
            まだ制作物がありません。「＋ 制作物を追加」から広告文・LP・チラシ・動画を登録し、<mark>下書き → レビュー → 承認 → 公開</mark>まで進められます。
          </p>
        ) : null}
        {assets.length > 0 ? (
          <div className="asset-grid">
            {assets.map((a) => <AssetCard key={a.id} asset={a} project={project} canPublish={canPublish} canEdit={canEdit} onChanged={onChanged} />)}
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

function KpiProgressCard({ project }: { project: ProjectDetailDto }) {
  const k = project.kpiProgress;
  const paceCls: Record<string, string> = { ahead: 'up', ontrack: 'up', behind: 'down', none: 'flat' };
  const cpaCls: Record<string, string> = { good: 'up', warn: 'warn', bad: 'down', none: 'flat' };
  const hasTargets = k.cv.target !== null || k.cpa.target !== null || k.spend.budget !== null;
  if (!hasTargets) {
    return (
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="c-head"><h2>🎯 今月の目標と進捗</h2></div>
        <div className="c-body"><p style={{ margin: 0, color: 'var(--muted)', fontSize: 13 }}>「配信設定」タブで目標CV・目標CPA・月予算を設定すると、達成ペースがここに表示されます。</p></div>
      </div>
    );
  }
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="c-head"><h2>🎯 今月の目標と進捗</h2>
        <span className="kpi-days">{k.daysElapsed}/{k.daysInMonth}日経過</span>
      </div>
      <div className="c-body kpi-prog-grid">
        {k.cv.target !== null ? (
          <div className="kpi-prog">
            <div className="kp-top"><span className="kp-l">CV (目標 {formatNumber(k.cv.target)}件)</span>
              <span className={`pill ${paceCls[k.cv.status]}`}>{PACE_STATUS_LABEL[k.cv.status]}</span></div>
            <div className="kp-v">{formatNumber(k.cv.actual)}<span className="kp-sub"> → 着地 {formatNumber(k.cv.projected)}件</span></div>
            <div className="kp-bar"><div className={`kp-fill ${paceCls[k.cv.status]}`} style={{ width: `${Math.min(100, k.cv.pct ?? 0)}%` }} /></div>
            <div className="kp-pct">着地予測 {k.cv.pct !== null ? `${k.cv.pct}%` : '—'}</div>
          </div>
        ) : null}
        {k.cpa.target !== null ? (
          <div className="kpi-prog">
            <div className="kp-top"><span className="kp-l">CPA (目標 {formatYen(k.cpa.target)})</span>
              <span className={`pill ${cpaCls[k.cpa.status]}`}>{k.cpa.status === 'good' ? '目標内' : k.cpa.status === 'warn' ? 'やや超過' : k.cpa.status === 'bad' ? '超過' : '—'}</span></div>
            <div className="kp-v">{formatYen(k.cpa.actual)}</div>
            <div className="kp-note">目標 {formatYen(k.cpa.target)} に対する当月実績</div>
          </div>
        ) : null}
        {k.spend.budget !== null ? (
          <div className="kpi-prog">
            <div className="kp-top"><span className="kp-l">予算消化 (月予算 {formatYen(k.spend.budget)})</span>
              <span className={`pill ${(k.spend.pct ?? 0) > 105 ? 'down' : 'flat'}`}>{k.spend.pct !== null ? `${k.spend.pct}%着地` : '—'}</span></div>
            <div className="kp-v">{formatYen(k.spend.actual)}<span className="kp-sub"> → 着地 {formatYen(k.spend.projected)}</span></div>
            <div className="kp-bar"><div className="kp-fill flat" style={{ width: `${Math.min(100, ((k.spend.actual) / k.spend.budget) * 100)}%` }} /></div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

const FATIGUE_META: Record<string, { label: string; cls: string }> = {
  fatigued: { label: '疲弊', cls: 'down' },
  watch: { label: '注意', cls: 'warn' },
  ok: { label: '安定', cls: 'flat' },
};

function ImproveTab({ project, goFiltered }: { project: ProjectDetailDto; goFiltered: (href: string) => void }) {
  const { me } = useAuth();
  const isAgency = me.edition === 'agency';
  const budget = useApi<BudgetPlanDto>(`/projects/${project.id}/budget-plan`);
  const fatigue = useApi<FatigueReportDto>(`/projects/${project.id}/fatigue`);

  return (
    <>
      {/* 予算の最適配分 */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="c-head"><h2>💰 予算の最適配分</h2></div>
        <div className="c-body">
          {budget.loading ? <SkeletonLines count={3} /> : budget.error ? <ErrorCard error={budget.error} onRetry={budget.retry} /> : budget.data ? (
            <>
              <div className="reall-summary">
                <div><div className="rs-l">再配分できる予算</div><div className="rs-v">{formatYen(budget.data.reallocatable)}<span className="rs-u">/月</span></div></div>
                <div><div className="rs-l">見込めるCV増</div><div className="rs-v up">+{budget.data.expectedCvGain}<span className="rs-u">件/月</span></div></div>
              </div>
              <p className="reall-note">{budget.data.note}</p>
              {budget.data.items.length > 0 ? (
                <div className="tbl-scroll">
                  <table className="data-tbl">
                    <thead><tr><th>推奨</th><th>キャンペーン</th><th>現在月額</th><th>CV</th><th>CPA</th><th>増減</th></tr></thead>
                    <tbody>
                      {budget.data.items.map((it) => (
                        <tr key={it.campaignId}>
                          <td><span className={`pill ${it.action === 'increase' ? 'up' : it.action === 'decrease' ? 'warn' : 'flat'}`}>
                            {it.action === 'increase' ? '▲ 増額' : it.action === 'decrease' ? '▼ 減額' : '＝ 維持'}</span></td>
                          <td><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><PlatformTag platform={it.platform} /><span>{it.campaignName}</span></div>
                            <div style={{ fontSize: 11, color: 'var(--muted)' }}>{it.reason}</div></td>
                          <td>{formatYen(it.monthlyCost)}</td>
                          <td>{formatNumber(it.conversions)}</td>
                          <td>{formatYen(it.cpa)}</td>
                          <td>{it.recommendedChange === 0 ? '—' :
                            <span className={`num`} style={{ fontWeight: 700, color: it.recommendedChange > 0 ? 'var(--good)' : 'var(--bad)' }}>
                              {it.recommendedChange > 0 ? '+' : ''}{formatYen(it.recommendedChange)}</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </div>

      {/* クリエイティブ疲弊検知 */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="c-head"><h2>🎨 クリエイティブ疲弊検知</h2>
          {fatigue.data && fatigue.data.fatiguedCount > 0 ? <span className="pill down" style={{ marginLeft: 'auto' }}>要差し替え {fatigue.data.fatiguedCount}</span> : null}
        </div>
        <div className="c-body">
          {fatigue.loading ? <SkeletonLines count={2} /> : fatigue.error ? <ErrorCard error={fatigue.error} onRetry={fatigue.retry} /> : fatigue.data ? (
            fatigue.data.items.length === 0 ? (
              <p style={{ margin: 0, color: 'var(--muted)' }}>判定できる配信量のキャンペーンがまだありません。</p>
            ) : (
              <div className="fatigue-list">
                {fatigue.data.items.map((it) => {
                  const m = FATIGUE_META[it.level];
                  return (
                    <div key={it.campaignId} className={`fatigue-row ${it.level}`}>
                      <div className="fat-head">
                        <PlatformTag platform={it.platform} />
                        <span className="fat-name">{it.campaignName}</span>
                        <span className={`pill ${m.cls}`} style={{ marginLeft: 'auto' }}>{m.label}</span>
                      </div>
                      <div className="fat-metrics">
                        CTR {it.ctrPrior ?? '—'}% → <b>{it.ctrRecent ?? '—'}%</b>
                        {it.ctrDeltaPct !== null ? <span className={it.ctrDeltaPct < 0 ? 'fat-down' : 'fat-up'}> ({it.ctrDeltaPct > 0 ? '+' : ''}{it.ctrDeltaPct}%)</span> : null}
                      </div>
                      <div className="fat-rec">{it.recommendation}</div>
                    </div>
                  );
                })}
              </div>
            )
          ) : null}
        </div>
      </div>

      {/* 改善アクション */}
      <div className="card">
        <div className="c-head"><h2>改善アクション</h2></div>
        <div className="c-body form-grid">
          <p style={{ margin: 0, fontSize: 14, color: 'var(--ink-2)' }}>
            未対応の改善提案は <b className="num" style={{ color: project.openFindings > 0 ? 'var(--warn)' : 'var(--good)' }}>{project.openFindings}件</b> です。
          </p>
          <div className="proj-actions">
            {isAgency ? <button className="btn pri" onClick={() => goFiltered('/audit')}>🩺 AI診断</button> : null}
            <button className="btn sec" onClick={() => goFiltered('/keywords')}>🔍 キーワード最適化・発見</button>
            {isAgency ? <button className="btn sec" onClick={() => goFiltered('/approvals')}>✅ 承認キュー</button> : null}
            <button className="btn sec" onClick={() => goFiltered('/report')}>📄 レポート{isAgency ? '作成' : ''}</button>
          </div>
        </div>
      </div>
    </>
  );
}

export default function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { me } = useAuth();
  const isAgency = me.edition === 'agency';
  const { setSelectedClientId } = useClients();
  const detail = useApi<ProjectDetailDto>(`/projects/${id}`);
  const [tab, setTab] = useState<Tab>('cycle');
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
                {t.key === 'hearing' ? <span className="wtab-count">{briefCompleteness(d.brief).pct}%</span> : null}
                {t.key === 'assets' && d.assets.length > 0 ? <span className="wtab-count">{d.assets.length}</span> : null}
                {t.key === 'alerts' && d.alerts.length > 0 ? <span className="wtab-count">{d.alerts.length}</span> : null}
                {t.key === 'improve' && d.openFindings > 0 ? <span className="wtab-count">{d.openFindings}</span> : null}
              </button>
            ))}
          </div>

          {/* --- 運用サイクル --- */}
          {tab === 'cycle' ? <OpsCycleTab project={d} goTab={(t) => setTab(t as Tab)} /> : null}

          {/* --- 概要（推移） --- */}
          {tab === 'overview' ? (
            <>
              <KpiProgressCard project={d} />
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
                {isAgency ? <button className="btn sm sec" style={{ marginLeft: 'auto' }} onClick={() => goFiltered('/connections')}>媒体接続を管理</button> : null}
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

          {/* --- ヒアリング --- */}
          {tab === 'hearing' ? <HearingTab project={d} onSaved={detail.refresh} /> : null}

          {/* --- 配信設定 --- */}
          {tab === 'settings' ? <SettingsTab project={d} onSaved={detail.refresh} /> : null}

          {/* --- 制作物 --- */}
          {tab === 'assets' ? <AssetsTab project={d} onChanged={detail.refresh} /> : null}

          {/* --- アラート --- */}
          {tab === 'alerts' ? (
            <div className="card">
              <div className="c-head"><h2>このプロジェクトのアラート</h2>
                {isAgency ? <button className="btn sm sec" style={{ marginLeft: 'auto' }} onClick={() => goFiltered('/alerts')}>アラート設定へ</button> : null}
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
          {tab === 'improve' ? <ImproveTab project={d} goFiltered={goFiltered} /> : null}
        </>
      ) : null}
    </>
  );
}
