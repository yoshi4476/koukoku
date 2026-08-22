'use client';

import { useState, type FormEvent } from 'react';
import type { ChildTenantDto, CreateChildTenantInput } from '@adgrid/shared';
import { useApi } from '@/components/use-api';
import { useAuth } from '@/components/auth-context';
import { EmptyState, ErrorCard, HintBar, SkeletonLines } from '@/components/ui';
import { apiPost, ApiError, toApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';

function CreateTenantForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [companyName, setCompanyName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const body: CreateChildTenantInput = { companyName: companyName.trim(), adminEmail: adminEmail.trim(), adminPassword };
    apiPost<ChildTenantDto>('/reseller/tenants', body)
      .then(() => onDone())
      .catch((err: unknown) => setError(toApiError(err)))
      .finally(() => setBusy(false));
  };

  return (
    <form className="card" style={{ maxWidth: 640, marginBottom: 16 }} onSubmit={submit}>
      <div className="c-head"><h2>提供先テナントを発行</h2></div>
      <div className="c-body form-grid">
        {error ? <ErrorCard error={error} /> : null}
        <div className="field">
          <label htmlFor="rt-name">会社名（提供先）</label>
          <input id="rt-name" className="input" value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="例: 株式会社サンプル" required />
        </div>
        <div className="proj-form-row">
          <div className="field">
            <label htmlFor="rt-email">管理者メール</label>
            <input id="rt-email" className="input" type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} placeholder="admin@sample.co.jp" required />
          </div>
          <div className="field">
            <label htmlFor="rt-pass">初期パスワード（8文字以上）</label>
            <input id="rt-pass" className="input" type="password" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} required />
          </div>
        </div>
        <div className="f-actions">
          <button type="submit" className="btn pri" disabled={busy || !companyName.trim() || !adminEmail.trim() || adminPassword.length < 8}>
            {busy ? '発行中…' : 'テナントを発行'}
          </button>
          <button type="button" className="btn sec" onClick={onCancel}>キャンセル</button>
        </div>
      </div>
    </form>
  );
}

export default function ResellerPage() {
  const { switchTenant } = useAuth();
  const tenants = useApi<ChildTenantDto[]>('/reseller/tenants');
  const [showForm, setShowForm] = useState(false);
  const list = tenants.data ?? [];

  return (
    <>
      <div className="page-h">
        <h1>提供先テナント</h1>
        <span className="sub">他社ごとに独立テナントを発行し、自社から一元管理します</span>
        <button type="button" className="btn pri" style={{ marginLeft: 'auto' }} onClick={() => setShowForm((v) => !v)}>
          {showForm ? '閉じる' : '＋ テナントを発行'}
        </button>
      </div>

      <HintBar id="reseller" title="提供先テナントの使い方">
        他社ごとに<mark>独立したテナント（ワークスペース）</mark>を発行します。データは<mark>完全に分離</mark>され、他社は自分のテナントだけを使います。自社は<mark>「このテナントで管理」</mark>で中に入って設定・運用でき、右上のテナント切替でいつでも自社に戻れます。
      </HintBar>

      {showForm ? <CreateTenantForm onDone={() => { setShowForm(false); tenants.retry(); }} onCancel={() => setShowForm(false)} /> : null}

      {tenants.error ? <ErrorCard error={tenants.error} onRetry={tenants.retry} /> : null}
      {tenants.loading ? <div className="card"><div className="c-body"><SkeletonLines count={3} /></div></div> : null}

      {tenants.data && list.length === 0 && !showForm ? (
        <EmptyState
          title="まだ提供先テナントはありません"
          sub="他社に提供する独立テナントを発行しましょう。発行後、管理者ログインを他社に渡せます。"
          action={<button className="btn pri" onClick={() => setShowForm(true)}>＋ テナントを発行</button>}
        />
      ) : null}

      {list.length > 0 ? (
        <div className="rt-grid">
          {list.map((t) => (
            <div key={t.id} className="rt-card">
              <div className="rt-head">
                <span className="rt-name">🏷 {t.name}</span>
                <span className="pill flat" style={{ marginLeft: 'auto' }}>提供先版</span>
              </div>
              <div className="rt-meta">管理者ログイン: <b>{t.adminEmail}</b></div>
              <div className="rt-meta">発行日: {formatDate(t.createdAt)}</div>
              <div className="rt-actions">
                <button className="btn sm pri" onClick={() => switchTenant(t.id)}>このテナントで管理 →</button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}
