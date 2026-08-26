'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type {
  AdAccountDto,
  ClientAccessDto,
  ClientDto,
  ClientOverviewDto,
  CreateClientAccessInput,
  MeasurementConfigDto,
  MeasurementHealthDto,
  Platform,
  SampleDataResultDto,
  ShareLinkDto,
} from '@adgrid/shared';
import { ALL_PLATFORMS, PLATFORM_META, industryModeFor } from '@adgrid/shared';
import { useApi } from '@/components/use-api';
import { useClients } from '@/components/client-context';
import { DeltaPill, ErrorCard, HintBar, Skeleton } from '@/components/ui';
import { apiDelete, apiGet, apiPost, apiPut, ApiError, toApiError } from '@/lib/api';
import { AUDIT_CATEGORY_LABEL, INDUSTRY_LABEL } from '@/lib/labels';
import { formatDate, formatNumber, formatYen } from '@/lib/format';

/* ---- クライアント追加 (ページ上部のインラインフォーム) ---- */
function AddClientForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [industry, setIndustry] = useState('ec');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (saving || !name.trim()) return;
    setSaving(true);
    setError(null);
    apiPost<ClientDto>('/clients', { name: name.trim(), industryCode: industry })
      .then(() => {
        setSaving(false);
        onDone();
      })
      .catch((err: unknown) => {
        setError(toApiError(err));
        setSaving(false);
      });
  };

  return (
    <form className="inline-form form-grid" style={{ marginBottom: 16 }} onSubmit={submit}>
      {error ? <ErrorCard error={error} /> : null}
      <div className="row-actions">
        <div className="field">
          <label htmlFor="new-client-name">クライアント名</label>
          <input
            id="new-client-name"
            className="input"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例: 株式会社サンプル"
            disabled={saving}
          />
        </div>
        <div className="field">
          <label htmlFor="new-client-industry">業種</label>
          <select
            id="new-client-industry"
            className="select"
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            disabled={saving}
          >
            {Object.entries(INDUSTRY_LABEL).map(([code, label]) => (
              <option key={code} value={code}>{label}</option>
            ))}
          </select>
        </div>
        <div style={{ alignSelf: 'flex-end', display: 'flex', gap: 8 }}>
          <button type="submit" className="btn pri" disabled={saving || !name.trim()}>
            {saving ? '登録中…' : 'クライアントを登録'}
          </button>
          <button type="button" className="btn sec" onClick={onCancel} disabled={saving}>
            キャンセル
          </button>
        </div>
      </div>
    </form>
  );
}

/* ---- 広告アカウント追加 (カード内のインラインフォーム) ---- */
function AddAccountForm({
  clientId,
  onDone,
  onCancel,
}: {
  clientId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [platform, setPlatform] = useState<Platform>('google_ads');
  const [name, setName] = useState('');
  const [budget, setBudget] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);
    const monthlyBudget = budget.trim() === '' ? undefined : Number(budget);
    apiPost<AdAccountDto>(`/clients/${clientId}/accounts`, {
      platform,
      name: name.trim() || undefined,
      ...(monthlyBudget !== undefined && Number.isFinite(monthlyBudget) ? { monthlyBudget } : {}),
    })
      .then(() => {
        setSaving(false);
        onDone();
      })
      .catch((err: unknown) => {
        setError(toApiError(err));
        setSaving(false);
      });
  };

  return (
    <form className="inline-form form-grid" onSubmit={submit}>
      {error ? <ErrorCard error={error} /> : null}
      <div className="field">
        <label htmlFor={`acc-platform-${clientId}`}>媒体</label>
        <select
          id={`acc-platform-${clientId}`}
          className="select"
          value={platform}
          onChange={(e) => setPlatform(e.target.value as Platform)}
          disabled={saving}
        >
          {ALL_PLATFORMS.map((p) => (
            <option key={p} value={p}>{PLATFORM_META[p].label}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`acc-name-${clientId}`}>アカウント名</label>
        <input
          id={`acc-name-${clientId}`}
          className="input"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="例: メインアカウント"
          disabled={saving}
        />
      </div>
      <div className="field">
        <label htmlFor={`acc-budget-${clientId}`}>月予算 (円・任意)</label>
        <input
          id={`acc-budget-${clientId}`}
          className="input num"
          type="number"
          min={0}
          value={budget}
          onChange={(e) => setBudget(e.target.value)}
          placeholder="例: 500000"
          disabled={saving}
        />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="submit" className="btn sm pri" disabled={saving}>
          {saving ? '追加中…' : 'アカウントを追加'}
        </button>
        <button type="button" className="btn sm sec" onClick={onCancel} disabled={saving}>
          キャンセル
        </button>
      </div>
    </form>
  );
}

/* 業種モード: この業種向けの相場・訴求・診断重点・用語をまとめて可視化 */
function IndustryModePanel({ industryCode }: { industryCode: string }) {
  const { profile, benchmark } = industryModeFor(industryCode);
  return (
    <div className="ind-mode">
      <div className="ind-row">
        <span className="ind-label">相場 (目標値)</span>
        <span className="ind-val num">
          CTR {benchmark.ctr}% · CVR {benchmark.cvr}% · CPA ¥{benchmark.cpa.toLocaleString()}
        </span>
      </div>
      <div className="ind-row">
        <span className="ind-label">推奨する訴求</span>
        <span className="ind-chips">
          {profile.appealAxes.map((a) => (
            <span key={a} className="ind-chip pri">{a}</span>
          ))}
        </span>
      </div>
      <div className="ind-row">
        <span className="ind-label">診断の重点</span>
        <span className="ind-chips">
          {profile.diagnosisFocus.map((d) => (
            <span key={d} className="ind-chip">{AUDIT_CATEGORY_LABEL[d] ?? d}</span>
          ))}
        </span>
      </div>
      <div className="ind-row">
        <span className="ind-label">CVの呼び方</span>
        <span className="ind-val">「{profile.cvLabel}」</span>
      </div>
      {profile.ngWords.length > 0 ? (
        <div className="ind-row">
          <span className="ind-label">要注意表現</span>
          <span className="ind-chips">
            {profile.ngWords.slice(0, 6).map((w) => (
              <span key={w} className="ind-chip ng">{w}</span>
            ))}
          </span>
        </div>
      ) : null}
      <p className="ind-tip">💡 {profile.tip}</p>
    </div>
  );
}

/* 提供先アクセス発行 (このクライアント専用ログイン) */
function ClientAccessPanel({ clientId }: { clientId: string }) {
  const access = useApi<ClientAccessDto[]>(`/clients/${clientId}/access`);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const issue = (e: FormEvent) => {
    e.preventDefault();
    if (busy || !email.trim() || password.length < 8) return;
    setBusy(true);
    setError(null);
    const body: CreateClientAccessInput = { email: email.trim(), password };
    apiPost<ClientAccessDto>(`/clients/${clientId}/access`, body)
      .then(() => { setEmail(''); setPassword(''); access.retry(); })
      .catch((err: unknown) => setError(toApiError(err)))
      .finally(() => setBusy(false));
  };
  const revoke = (userId: string, mail: string) => {
    if (busy) return;
    if (!window.confirm(`${mail} のログインを無効化します。よろしいですか？`)) return;
    setBusy(true);
    setError(null);
    apiDelete(`/clients/${clientId}/access/${userId}`)
      .then(() => access.retry())
      .catch((err: unknown) => setError(toApiError(err)))
      .finally(() => setBusy(false));
  };

  const list = access.data ?? [];
  return (
    <div className="cl-access">
      <div className="cl-access-h">🔑 提供先アクセス（この会社専用ログイン）</div>
      {list.length > 0 ? (
        <div className="cl-access-list">
          {list.map((a) => (
            <div key={a.userId} className="cl-access-row">
              <span className="cl-access-mail">{a.email}</span>
              <button type="button" className="btn sm sec" onClick={() => revoke(a.userId, a.email)} disabled={busy}>無効化</button>
            </div>
          ))}
        </div>
      ) : <p className="cl-access-empty">まだ発行していません。下から発行できます。</p>}
      {error ? <ErrorCard error={error} /> : null}
      <form className="cl-access-form" onSubmit={issue}>
        <input className="input" type="email" placeholder="提供先のメール" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <input className="input" type="password" placeholder="初期パスワード(8文字以上)" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <button type="submit" className="btn sm pri" disabled={busy || !email.trim() || password.length < 8}>{busy ? '発行中…' : 'アクセスを発行'}</button>
      </form>
    </div>
  );
}

/* 計測基盤 (GA4/CAPI) の設定・ヘルス */
function MeasurementForm({ initial, clientId, onSaved }: { initial: MeasurementConfigDto; clientId: string; onSaved: () => void }) {
  const [ga4, setGa4] = useState(initial.ga4MeasurementId);
  const [pixel, setPixel] = useState(initial.metaPixelId);
  const [server, setServer] = useState(initial.serverSideEnabled);
  const [enhanced, setEnhanced] = useState(initial.enhancedConversions);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const save = () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    apiPut(`/clients/${clientId}/measurement`, { ga4MeasurementId: ga4, metaPixelId: pixel, serverSideEnabled: server, enhancedConversions: enhanced })
      .then(() => onSaved())
      .catch((err: unknown) => setError(toApiError(err)))
      .finally(() => setBusy(false));
  };
  return (
    <div className="meas-form">
      <div className="set-row">
        <div className="field"><label>GA4 測定ID</label><input className="input" value={ga4} onChange={(e) => setGa4(e.target.value)} placeholder="G-XXXXXXX" /></div>
        <div className="field"><label>Meta ピクセルID</label><input className="input" value={pixel} onChange={(e) => setPixel(e.target.value)} placeholder="数字のピクセルID" /></div>
      </div>
      <div className="set-row">
        <label className="set-check"><input type="checkbox" checked={server} onChange={(e) => setServer(e.target.checked)} /> サーバーサイド計測 (CAPI/拡張CV) を使う</label>
        <label className="set-check"><input type="checkbox" checked={enhanced} onChange={(e) => setEnhanced(e.target.checked)} /> 拡張コンバージョン</label>
      </div>
      {!initial.serverKeysReady && server ? <p className="meas-warn">※ サーバー送信の鍵 (META_CAPI_ACCESS_TOKEN / GA4_API_SECRET) が未設定です。.env に設定すると実送信されます。</p> : null}
      {error ? <ErrorCard error={error} /> : null}
      <button className="btn sm pri" disabled={busy} onClick={save}>{busy ? '保存中…' : '計測設定を保存'}</button>
    </div>
  );
}

function MeasurementPanel({ clientId }: { clientId: string }) {
  const cfg = useApi<MeasurementConfigDto>(`/clients/${clientId}/measurement`);
  const health = useApi<MeasurementHealthDto>(`/clients/${clientId}/measurement/health`);
  const gradeCls: Record<string, string> = { good: 'up', warn: 'warn', bad: 'down' };
  const refresh = () => { cfg.refresh(); health.refresh(); };

  return (
    <div className="access-panel">
      <div className="ap-head">📡 計測基盤（GA4 / CAPI）</div>
      <p className="ap-desc">CV計測が正確なほど、AIの最適化精度が上がります。特に<b>サーバーサイド計測(CAPI/拡張CV)</b>はiOS/クッキー制限に強く、CVの取りこぼしを防ぎます。</p>
      {health.loading || cfg.loading ? <Skeleton w="100%" h={40} /> : null}
      {health.error ? <ErrorCard error={health.error} onRetry={health.retry} /> : null}
      {health.data ? (
        <div className={`meas-health ${gradeCls[health.data.grade]}`}>
          <div className="meas-score-row">
            <div className="meas-score">{health.data.score}<span>/100</span></div>
            <div className="meas-bar"><div className={`meas-fill ${gradeCls[health.data.grade]}`} style={{ width: `${health.data.score}%` }} /></div>
          </div>
          <p className="meas-summary">{health.data.summary}</p>
          <ul className="meas-items">
            {health.data.items.map((i) => (
              <li key={i.key} className={i.ok ? 'ok' : 'ng'}>
                <span className="mi-mark">{i.ok ? '✓' : '✗'}</span>
                <div><b>{i.label}</b><span className="mi-detail">{i.detail}</span></div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {cfg.data ? <MeasurementForm initial={cfg.data} clientId={clientId} onSaved={refresh} /> : null}
    </div>
  );
}

/* クライアント共有ポータル (閲覧専用リンクの発行・停止) */
function SharePanel({ clientId }: { clientId: string }) {
  const { data, loading, error, retry, refresh } = useApi<ShareLinkDto>(`/clients/${clientId}/share`);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [actError, setActError] = useState<ApiError | null>(null);
  const link = data?.token ? `${typeof window !== 'undefined' ? window.location.origin : ''}/share/${data.token}` : '';

  // 発行/停止の失敗を握りつぶすと、共有停止が失敗してもリンクが生きたまま
  // 停止済みに見える (無認証公開のため実害大)。エラーは必ず表示する
  const act = (fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setActError(null);
    fn().then(() => refresh()).catch((err: unknown) => setActError(toApiError(err))).finally(() => setBusy(false));
  };

  return (
    <div className="access-panel">
      <div className="ap-head">🔗 共有ポータル（閲覧専用リンク）</div>
      <p className="ap-desc">ログイン不要で成果ダッシュボードを見せる共有リンクを発行します。数値は常に最新です。停止するといつでも無効化できます。</p>
      {loading ? <Skeleton w="100%" h={30} /> : null}
      {error ? <ErrorCard error={error} onRetry={retry} /> : null}
      {actError ? <ErrorCard error={actError} /> : null}
      {data ? (
        data.enabled && link ? (
          <>
            <div className="share-link-row">
              <input className="input" readOnly value={link} onFocus={(e) => e.target.select()} />
              <button className="btn sm sec" onClick={() => navigator.clipboard?.writeText(link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); }, () => undefined)}>{copied ? '✓' : 'コピー'}</button>
              <a className="btn sm sec" href={link} target="_blank" rel="noopener noreferrer">開く</a>
            </div>
            <button className="btn sm sec danger-text" disabled={busy} onClick={() => act(() => apiDelete(`/clients/${clientId}/share`))}>共有を停止</button>
          </>
        ) : (
          <button className="btn sm pri" disabled={busy} onClick={() => act(() => apiPost(`/clients/${clientId}/share`, {}))}>{busy ? '発行中…' : '共有リンクを発行'}</button>
        )
      ) : null}
    </div>
  );
}

function ClientCard({ o, onChanged }: { o: ClientOverviewDto; onChanged: () => void }) {
  const [formOpen, setFormOpen] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [measOpen, setMeasOpen] = useState(false);
  const c = o.client;
  const qs = `clientId=${encodeURIComponent(c.id)}`;

  return (
    <div className="client-card">
      <div className="cl-head">
        <span className="cl-name">{c.name}</span>
        <button
          type="button"
          className={`tag tag-btn${modeOpen ? ' on' : ''}`}
          title="業種モード: この業種向けの最適化設定を表示"
          aria-expanded={modeOpen}
          onClick={() => setModeOpen((v) => !v)}
        >
          {INDUSTRY_LABEL[c.industryCode] ?? c.industryCode} 業種モード ▾
        </button>
        <span className="cl-meta num" style={{ marginLeft: 'auto' }}>アカウント {c.accountCount}件</span>
      </div>

      {modeOpen ? <IndustryModePanel industryCode={c.industryCode} /> : null}

      <div className="cl-kpis">
        <div>
          <div className="ck-label">消化額 (7日)</div>
          <div className="ck-val">{formatYen(o.cost7d)}</div>
        </div>
        <div>
          <div className="ck-label">CV</div>
          <div className="ck-val">{formatNumber(o.conversions7d)}</div>
        </div>
        <div>
          <div className="ck-label">CPA</div>
          <div className="ck-val">
            {formatYen(o.cpa7d)}
            <DeltaPill value={o.cpaDelta} invert />
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {o.openFindings > 0 ? (
          <Link href={`/audit?${qs}`} className="pill warn">未対応の提案 {o.openFindings}件</Link>
        ) : null}
        <span className="cl-meta">
          最終レポート: {o.lastReportAt ? formatDate(o.lastReportAt) : '未作成'}
        </span>
      </div>

      <div className="cl-actions">
        <Link className="btn sm sec" href={`/audit?${qs}`}>診断</Link>
        <Link className="btn sm sec" href={`/report?${qs}`}>レポート</Link>
        <button type="button" className="btn sm sec" aria-expanded={accessOpen} onClick={() => setAccessOpen((v) => !v)}>
          {accessOpen ? '閉じる' : '🔑 提供先アクセス'}
        </button>
        <button type="button" className="btn sm sec" aria-expanded={shareOpen} onClick={() => setShareOpen((v) => !v)}>
          {shareOpen ? '閉じる' : '🔗 共有ポータル'}
        </button>
        <button type="button" className="btn sm sec" aria-expanded={measOpen} onClick={() => setMeasOpen((v) => !v)}>
          {measOpen ? '閉じる' : '📡 計測'}
        </button>
        <button
          type="button"
          className="btn sm sec"
          style={{ marginLeft: 'auto' }}
          aria-expanded={formOpen}
          onClick={() => setFormOpen((v) => !v)}
        >
          {formOpen ? '閉じる' : 'アカウントを追加'}
        </button>
      </div>

      {accessOpen ? <ClientAccessPanel clientId={c.id} /> : null}
      {shareOpen ? <SharePanel clientId={c.id} /> : null}
      {measOpen ? <MeasurementPanel clientId={c.id} /> : null}

      {formOpen ? (
        <AddAccountForm
          clientId={c.id}
          onDone={() => {
            setFormOpen(false);
            onChanged();
          }}
          onCancel={() => setFormOpen(false)}
        />
      ) : null}
    </div>
  );
}

function ClientsSkeleton() {
  return (
    <div className="client-grid" aria-label="読み込み中">
      {Array.from({ length: 3 }, (_, i) => (
        <div className="client-card" key={i}>
          <Skeleton w="60%" h={16} />
          <Skeleton w="100%" h={52} />
          <Skeleton w="80%" h={14} />
          <Skeleton w="100%" h={26} />
        </div>
      ))}
    </div>
  );
}

export default function ClientsPage() {
  const router = useRouter();
  const { reload: reloadClients } = useClients();
  const overview = useApi<ClientOverviewDto[]>('/clients/overview');
  const [addOpen, setAddOpen] = useState(false);
  const [sampleRunning, setSampleRunning] = useState(false);
  const [sampleError, setSampleError] = useState<ApiError | null>(null);

  // 作成・追加後は一覧とトップバーのクライアント一覧の両方を更新する
  const refresh = () => {
    overview.retry();
    reloadClients();
  };

  const runSample = () => {
    if (sampleRunning) return;
    setSampleRunning(true);
    setSampleError(null);
    apiPost<SampleDataResultDto>('/onboarding/sample', {})
      .then((r) => {
        router.push(`/audit?clientId=${encodeURIComponent(r.clientId)}&accountId=${encodeURIComponent(r.adAccountId)}`);
      })
      .catch((err: unknown) => {
        setSampleError(toApiError(err));
        setSampleRunning(false);
      });
  };

  const list = overview.data ?? [];

  return (
    <>
      <div className="page-h">
        <h1>クライアント管理</h1>
        <span className="sub">担当クライアントの状況を一覧で確認できます</span>
        <span style={{ marginLeft: 'auto' }}>
          <button type="button" className="btn pri" aria-expanded={addOpen} onClick={() => setAddOpen((v) => !v)}>
            クライアントを追加
          </button>
        </span>
      </div>

      <HintBar id="clients" title="クライアント管理の使い方">
        担当クライアントの状況を一覧で確認できます。<mark>未対応の提案数</mark>や最終レポート日が見えるので、対応漏れを防げます。カードから診断・レポート・取込に直行。「アカウントを追加」で媒体アカウントを登録します。
      </HintBar>

      {addOpen ? (
        <AddClientForm
          onDone={() => {
            setAddOpen(false);
            refresh();
          }}
          onCancel={() => setAddOpen(false)}
        />
      ) : null}

      {sampleError ? <ErrorCard error={sampleError} onRetry={runSample} /> : null}
      {overview.error ? <ErrorCard error={overview.error} onRetry={overview.retry} /> : null}
      {overview.loading ? <ClientsSkeleton /> : null}

      {overview.data && list.length === 0 ? (
        <div className="empty">
          <div className="e-title">最初のクライアントを登録しましょう</div>
          <div className="e-sub">クライアントを登録してデータを取り込むと、AI診断とレポートが使えます。</div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button type="button" className="btn pri" onClick={() => setAddOpen(true)}>
              クライアントを追加
            </button>
            <button type="button" className="btn sec" onClick={runSample} disabled={sampleRunning}>
              {sampleRunning ? 'サンプルを準備中…' : 'サンプルデータで試す'}
            </button>
          </div>
        </div>
      ) : null}

      {list.length > 0 ? (
        <div className="client-grid">
          {list.map((o) => (
            <ClientCard key={o.client.id} o={o} onChanged={refresh} />
          ))}
        </div>
      ) : null}
    </>
  );
}
