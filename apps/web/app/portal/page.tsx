'use client';

import type { PortalCardDto } from '@adgrid/shared';
import { useApi } from '@/components/use-api';
import { ErrorCard, Skeleton } from '@/components/ui';
import { CONNECTION_STATUS_META, PLATFORM_COLOR_VAR } from '@/lib/labels';
import { formatDateTime } from '@/lib/format';

function PortalCard({ card }: { card: PortalCardDto }) {
  const status = CONNECTION_STATUS_META[card.connectionStatus];
  return (
    <div className="portal-card">
      <div className="p-head">
        <span className="dot" style={{ background: PLATFORM_COLOR_VAR[card.platform] }} />
        {card.label}
      </div>
      <div className="p-status">
        <span className="sig" style={{ background: status.colorVar }} aria-hidden="true" />
        {status.label}
        <span style={{ color: 'var(--muted)', fontSize: 11.5 }} className="num">
          · アカウント {card.accountCount}件
        </span>
      </div>
      <div className="p-sync num">最終同期 {card.lastSyncedAt ? formatDateTime(card.lastSyncedAt) : '未同期'}</div>
      {card.apiAvailability === 'partner_only' ? (
        <div className="p-note">API未提供 (認定パートナー限定) — CSV連携で代替</div>
      ) : null}
      <div className="p-links">
        <a className="btn sm sec" href={card.adminUrl} target="_blank" rel="noopener noreferrer">管理画面</a>
        <a className="btn sm sec" href={card.helpUrl} target="_blank" rel="noopener noreferrer">ヘルプ</a>
        <a className="btn sm sec" href={card.developerUrl} target="_blank" rel="noopener noreferrer">API</a>
      </div>
    </div>
  );
}

export default function PortalPage() {
  const { data, loading, error, retry } = useApi<PortalCardDto[]>('/portal');

  return (
    <>
      <div className="page-h">
        <h1>媒体窓口</h1>
        <span className="sub">各媒体の管理画面・ヘルプ・API情報と接続状態</span>
      </div>

      {error ? <ErrorCard error={error} onRetry={retry} /> : null}

      {loading ? (
        <div className="portal-grid">
          {Array.from({ length: 8 }, (_, i) => (
            <div className="portal-card" key={i}>
              <Skeleton w="55%" h={16} />
              <Skeleton w="40%" h={12} />
              <Skeleton w="70%" h={11} />
              <Skeleton w="100%" h={26} />
            </div>
          ))}
        </div>
      ) : null}

      {data ? (
        data.length === 0 ? (
          <div className="empty">
            <div className="e-title">表示できる媒体がありません</div>
            <div className="e-sub">APIサーバの初期データ (シード) を確認してください。</div>
            <button type="button" className="btn pri" onClick={retry}>再読み込み</button>
          </div>
        ) : (
          <div className="portal-grid">
            {data.map((card) => (
              <PortalCard key={card.platform} card={card} />
            ))}
          </div>
        )
      ) : null}
    </>
  );
}
