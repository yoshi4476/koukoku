'use client';

import { useState } from 'react';
import type { TenantConsoleDto, TenantUsageDto } from '@adgrid/shared';
import { useApi } from '@/components/use-api';
import { ErrorCard, SkeletonLines } from '@/components/ui';
import { apiPut, toApiError, type ApiError } from '@/lib/api';
import { formatDateTime, formatNumber, formatYen } from '@/lib/format';

/** 立ち上がり状況を一目で分かるようにする */
function StatusChip({ t }: { t: TenantUsageDto }) {
  if (t.status !== 'active') return <span className="pill down">停止中</span>;
  if (!t.onboarded) return <span className="pill warn">準備中</span>;
  if (t.cost30d > 0) return <span className="pill up">稼働中</span>;
  return <span className="pill ai">設定済み</span>;
}

function TenantRow({ t, onChanged }: { t: TenantUsageDto; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [confirm, setConfirm] = useState(false);
  const suspended = t.status !== 'active';

  const toggle = () => {
    setBusy(true); setError(null);
    apiPut(`/reseller/tenants/${t.id}/status`, { status: suspended ? 'active' : 'suspended' })
      .then(() => { setConfirm(false); onChanged(); })
      .catch((e: unknown) => setError(toApiError(e)))
      .finally(() => setBusy(false));
  };

  return (
    <div className={`tn-row${suspended ? ' off' : ''}`}>
      <div className="tn-head">
        <span className="tn-name">{t.name}</span>
        <StatusChip t={t} />
        <span className="tn-mail">{t.adminEmail}</span>
        <span className="tn-since num">発行 {formatDateTime(t.createdAt)}</span>
      </div>

      <div className="tn-stats">
        <div><span>クライアント</span><b className="num">{t.clientCount}</b></div>
        <div><span>プロジェクト</span><b className="num">{t.projectCount}</b></div>
        <div><span>広告アカウント</span><b className="num">{t.accountCount}</b></div>
        <div><span>ユーザー</span><b className="num">{t.userCount}</b></div>
        <div><span>広告費(30日)</span><b className="num">{formatYen(t.cost30d)}</b></div>
        <div><span>CV(30日)</span><b className="num">{formatNumber(t.conversions30d)}</b></div>
        <div><span>AI利用料(30日)</span><b className="num">{formatYen(t.aiCostJpy30d)}</b></div>
        <div><span>最終操作</span><b className="num sm">{t.lastActiveAt ? formatDateTime(t.lastActiveAt) : '未操作'}</b></div>
      </div>

      {!t.onboarded && t.status === 'active' ? (
        <div className="tn-warn">
          ⚠ まだ立ち上がっていません。{t.clientCount === 0 ? 'クライアント未登録' : '広告アカウント未接続'}です。
          発行しただけで放置されると解約につながります。<b>導入支援の連絡を</b>。
        </div>
      ) : null}

      {error ? <ErrorCard error={error} /> : null}

      <div className="tn-actions">
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
            <button type="button" className="btn sm pri" onClick={toggle} disabled={busy}>{busy ? '処理中…' : '実行'}</button>
            <button type="button" className="btn sm sec" onClick={() => setConfirm(false)} disabled={busy}>やめる</button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * テナント横断管理コンソール (F-60)。
 * 発行済みの提供先テナントを1画面で把握し、停止・再開まで行う。
 */
export function TenantConsole() {
  const c = useApi<TenantConsoleDto>('/reseller/tenants/console');
  const d = c.data;

  return (
    <div className="card section-gap">
      <div className="c-head">
        <h2>📊 発行済みテナントの状況</h2>
        {d ? <span className="pill flat" style={{ marginLeft: 'auto' }}>{d.totals.tenantCount}件</span> : null}
      </div>
      <div className="c-body">
        {c.loading ? <SkeletonLines count={5} /> : null}
        {c.error ? <ErrorCard error={c.error} onRetry={c.retry} /> : null}

        {d && d.tenants.length === 0 ? (
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13, lineHeight: 1.8 }}>
            まだ提供先テナントを発行していません。上のフォームから発行すると、ここに<mark>利用状況が一覧</mark>されます。
          </p>
        ) : null}

        {d && d.tenants.length > 0 ? (
          <>
            <div className="tn-totals">
              <div><span>テナント</span><b className="num">{d.totals.tenantCount}</b></div>
              <div><span>稼働中</span><b className="num up">{d.totals.activeCount}</b></div>
              <div><span>停止中</span><b className="num">{d.totals.suspendedCount}</b></div>
              <div><span>クライアント合計</span><b className="num">{d.totals.clientCount}</b></div>
              <div><span>広告費合計(30日)</span><b className="num">{formatYen(d.totals.cost30d)}</b></div>
              <div><span>AI利用料合計(30日)</span><b className="num">{formatYen(d.totals.aiCostJpy30d)}</b></div>
            </div>

            <div className="tn-list">
              {d.tenants.map((t) => <TenantRow key={t.id} t={t} onChanged={c.retry} />)}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
