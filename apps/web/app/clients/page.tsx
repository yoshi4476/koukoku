'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type {
  AdAccountDto,
  ClientDto,
  ClientOverviewDto,
  Platform,
  SampleDataResultDto,
} from '@adgrid/shared';
import { ALL_PLATFORMS, PLATFORM_META } from '@adgrid/shared';
import { useApi } from '@/components/use-api';
import { useClients } from '@/components/client-context';
import { DeltaPill, ErrorCard, HintBar, Skeleton } from '@/components/ui';
import { apiPost, ApiError, toApiError } from '@/lib/api';
import { INDUSTRY_LABEL } from '@/lib/labels';
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

function ClientCard({ o, onChanged }: { o: ClientOverviewDto; onChanged: () => void }) {
  const [formOpen, setFormOpen] = useState(false);
  const c = o.client;
  const qs = `clientId=${encodeURIComponent(c.id)}`;

  return (
    <div className="client-card">
      <div className="cl-head">
        <span className="cl-name">{c.name}</span>
        <span className="tag">{INDUSTRY_LABEL[c.industryCode] ?? c.industryCode}</span>
        <span className="cl-meta num" style={{ marginLeft: 'auto' }}>アカウント {c.accountCount}件</span>
      </div>

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
        <Link className="btn sm sec" href={`/import?${qs}`}>取込</Link>
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
