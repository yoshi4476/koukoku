'use client';

import { useMemo, useState } from 'react';
import type { PlatformConsoleDto, PlatformTenantDto } from '@adgrid/shared';
import { TENANT_PLANS, TENANT_PLAN_LABEL } from '@adgrid/shared';
import { useApi } from '@/components/use-api';
import { ErrorCard, SkeletonLines } from '@/components/ui';
import { apiPut, toApiError, type ApiError } from '@/lib/api';
import { formatDate, formatNumber, formatYen } from '@/lib/format';

type Contract = 'all' | 'direct' | 'resold';
type Filter = 'all' | 'stalled' | 'idle' | 'suspended';

/** 立ち上がり状況を一目で分かるようにする */
function StatusChip({ t }: { t: PlatformTenantDto }) {
  if (t.status !== 'active') return <span className="pill down">停止中</span>;
  if (!t.onboarded) return <span className="pill warn">準備中</span>;
  if (t.cost30d > 0) return <span className="pill up">稼働中</span>;
  return <span className="pill ai">設定済み</span>;
}

function TenantRow({ t, onChanged }: { t: PlatformTenantDto; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [confirm, setConfirm] = useState(false);
  const suspended = t.status !== 'active';

  const run = (p: Promise<unknown>) => {
    setBusy(true);
    setError(null);
    p.then(() => { setConfirm(false); onChanged(); })
      .catch((e: unknown) => setError(toApiError(e)))
      .finally(() => setBusy(false));
  };

  return (
    <div className={`tn-row${suspended ? ' off' : ''}`}>
      <div className="tn-head">
        <span className="tn-name">{t.name}</span>
        <StatusChip t={t} />
        <span className={`pill flat${t.parentTenantId ? '' : ' direct'}`}>
          {t.parentTenantId ? `提供元: ${t.parentTenantName ?? '—'}` : '直接契約'}
        </span>
        <span className="tn-mail">{t.adminEmail || '管理者未登録'}</span>
        <span className="tn-since num">登録 {formatDate(t.createdAt)}</span>
      </div>

      <div className="tn-stats">
        <div><span>クライアント</span><b className="num">{t.clientCount}</b></div>
        <div><span>プロジェクト</span><b className="num">{t.projectCount}</b></div>
        <div><span>広告アカウント</span><b className="num">{t.accountCount}</b></div>
        <div><span>ユーザー</span><b className="num">{t.userCount}</b></div>
        <div><span>広告費(30日)</span><b className="num">{formatYen(t.cost30d)}</b></div>
        <div><span>CV(30日)</span><b className="num">{formatNumber(t.conversions30d)}</b></div>
        <div><span>AI原価(30日)</span><b className="num">{formatYen(t.aiCostJpy30d)}</b></div>
        <div><span>最終操作</span><b className="num sm">{t.lastActiveAt ? formatDate(t.lastActiveAt) : '未操作'}</b></div>
      </div>

      {t.status === 'active' && !t.onboarded ? (
        <div className="tn-warn">
          ⚠ まだ立ち上がっていません（{t.clientCount === 0 ? 'クライアント未登録' : '広告アカウント未接続'}）。
          放置されると解約につながります。<b>導入支援の連絡を</b>。
        </div>
      ) : null}

      {t.status === 'active' && t.onboarded && !t.active30d ? (
        <div className="tn-warn">
          ⚠ 直近30日の操作がありません。休眠状態です。
        </div>
      ) : null}

      {error ? <ErrorCard error={error} /> : null}

      <div className="tn-actions">
        <label className="adm-plan">
          プラン
          <select
            className="input sm"
            value={t.plan}
            disabled={busy}
            onChange={(e) => run(apiPut(`/platform/tenants/${t.id}/plan`, { plan: e.target.value }))}
          >
            {TENANT_PLANS.map((p) => <option key={p} value={p}>{TENANT_PLAN_LABEL[p]}</option>)}
            {TENANT_PLANS.includes(t.plan as never) ? null : <option value={t.plan}>{t.plan}</option>}
          </select>
        </label>

        {!confirm ? (
          <button type="button" className={`btn sm ${suspended ? 'pri' : 'sec'}`} onClick={() => setConfirm(true)} disabled={busy}>
            {suspended ? '利用を再開する' : '利用を停止する'}
          </button>
        ) : (
          <>
            <span className="tn-confirm">
              {suspended
                ? `${t.name} の利用を再開します。よろしいですか？`
                : `${t.name} を停止すると、このテナントの全員がログインできなくなります。よろしいですか？`}
            </span>
            <button
              type="button"
              className="btn sm pri"
              disabled={busy}
              onClick={() => run(apiPut(`/platform/tenants/${t.id}/status`, { status: suspended ? 'active' : 'suspended' }))}
            >
              {busy ? '処理中…' : '実行'}
            </button>
            <button type="button" className="btn sm sec" onClick={() => setConfirm(false)} disabled={busy}>やめる</button>
          </>
        )}
      </div>
    </div>
  );
}

export default function AdminPage() {
  const c = useApi<PlatformConsoleDto>('/platform/console');
  const [q, setQ] = useState('');
  const [contract, setContract] = useState<Contract>('all');
  const [filter, setFilter] = useState<Filter>('all');
  const d = c.data;

  const list = useMemo(() => {
    const all = d?.tenants ?? [];
    const needle = q.trim().toLowerCase();
    return all.filter((t) => {
      if (needle && !`${t.name} ${t.adminEmail} ${t.id}`.toLowerCase().includes(needle)) return false;
      if (contract === 'direct' && t.parentTenantId) return false;
      if (contract === 'resold' && !t.parentTenantId) return false;
      if (filter === 'stalled' && !(t.status === 'active' && !t.onboarded)) return false;
      if (filter === 'idle' && !(t.status === 'active' && t.onboarded && !t.active30d)) return false;
      if (filter === 'suspended' && t.status === 'active') return false;
      return true;
    });
  }, [d, q, contract, filter]);

  const o = d?.overview;

  return (
    <>
      <div className="page-h">
        <h1>テナント管理</h1>
        <span className="sub">このシステムを利用している全テナントを横断して管理します</span>
      </div>

      {c.loading ? <div className="card"><div className="c-body"><SkeletonLines count={6} /></div></div> : null}
      {c.error ? <ErrorCard error={c.error} onRetry={c.retry} /> : null}

      {o ? (
        <>
          <div className="adm-kpis">
            <div className="adm-kpi"><span>テナント</span><b className="num">{o.tenantCount}</b><small>直接 {o.directCount} / 提供元経由 {o.resoldCount}</small></div>
            <div className="adm-kpi"><span>稼働中</span><b className="num up">{o.activeCount}</b><small>30日以内に操作 {o.active30dCount}</small></div>
            {/* 0件のときに警告色を出すと「常に何か問題がある」ように見えるため、件数があるときだけ強調する */}
            <div className={`adm-kpi${o.stalledCount > 0 ? ' warn' : ''}`}><span>要フォロー</span><b className="num">{o.stalledCount}</b><small>立ち上がっていない</small></div>
            <div className="adm-kpi"><span>停止中</span><b className="num">{o.suspendedCount}</b><small>30日の新規 {o.newIn30d}</small></div>
            <div className="adm-kpi"><span>広告費 合計(30日)</span><b className="num">{formatYen(o.cost30d)}</b><small>全テナント</small></div>
            <div className="adm-kpi"><span>AI原価 合計(30日)</span><b className="num">{formatYen(o.aiCostJpy30d)}</b><small>運営側の変動費</small></div>
            <div className="adm-kpi"><span>ユーザー</span><b className="num">{o.userCount}</b><small>クライアント {o.clientCount} / 案件 {o.projectCount}</small></div>
            <div className="adm-kpi"><span>プラン内訳</span><b className="num sm">
              {Object.entries(o.planCounts).map(([p, n]) => `${TENANT_PLAN_LABEL[p as never] ?? p} ${n}`).join(' / ') || '—'}
            </b><small>請求区分</small></div>
          </div>

          <div className="adm-filters">
            <input
              className="input"
              placeholder="会社名・管理者メールで検索"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ maxWidth: 280 }}
            />
            <select className="input sm" value={contract} onChange={(e) => setContract(e.target.value as Contract)}>
              <option value="all">契約: すべて</option>
              <option value="direct">直接契約のみ</option>
              <option value="resold">提供元経由のみ</option>
            </select>
            <select className="input sm" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
              <option value="all">状態: すべて</option>
              <option value="stalled">要フォロー（立ち上がっていない）</option>
              <option value="idle">休眠（30日操作なし）</option>
              <option value="suspended">停止中</option>
            </select>
            <span className="adm-count">{list.length} / {o.tenantCount} 件</span>
          </div>

          <div className="tn-list">
            {list.length === 0 ? (
              <p style={{ color: 'var(--muted)', fontSize: 13 }}>条件に合うテナントがありません。</p>
            ) : (
              list.map((t) => <TenantRow key={t.id} t={t} onChanged={c.retry} />)
            )}
          </div>
        </>
      ) : null}
    </>
  );
}
