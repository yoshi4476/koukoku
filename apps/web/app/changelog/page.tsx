'use client';

import type { ChangeLogDto } from '@adgrid/shared';
import { useApi } from '@/components/use-api';
import { useClients } from '@/components/client-context';
import { EmptyState, ErrorCard, PlatformTag, SkeletonLines } from '@/components/ui';
import { CHANGELOG_ACTOR_META } from '@/lib/labels';
import { formatDateTime, formatYen } from '@/lib/format';

const ENTITY_LABEL: Record<string, string> = {
  account: 'アカウント',
  campaign: 'キャンペーン',
  adgroup: '広告グループ',
  ad: '広告',
};

const FIELD_LABEL: Record<string, string> = {
  budget: '予算',
  bid: '入札',
  status: 'ステータス',
};

const STATUS_VALUE_LABEL: Record<string, string> = {
  active: '配信中',
  paused: '停止',
  enabled: '有効',
  disabled: '無効',
  removed: '削除済',
};

/** 変更値を人間可読に整形する (予算=¥整形 / ステータス=日本語化) */
function formatChangeValue(field: string, value: string): string {
  if (!value) return '—';
  if (field === 'budget') {
    const n = Number(value);
    if (Number.isFinite(n)) return formatYen(n);
  }
  if (field === 'status') return STATUS_VALUE_LABEL[value] ?? value;
  return value;
}

function ChangeRow({ item }: { item: ChangeLogDto }) {
  const actor = CHANGELOG_ACTOR_META[item.actor];
  const entity = ENTITY_LABEL[item.entity] ?? item.entity;
  const field = FIELD_LABEL[item.field] ?? item.field;
  return (
    <li className="tl-item">
      <span className={`tl-dot${item.actor === 'adgrid' ? ' adgrid' : ''}`} aria-hidden="true" />
      <div className="tl-body">
        <div className="tl-head">
          <span className="tl-time num">{formatDateTime(item.changedAt)}</span>
          <span className={`pill ${actor.cls}`}>{actor.label}</span>
        </div>
        <div className="tl-meta">
          <span className="tag">{item.clientName}</span>
          <PlatformTag platform={item.platform} />
          <span className="tl-acct">{item.accountName}</span>
        </div>
        <div className="tl-change">
          <span className="tl-entity">{entity}の{field}</span>
          <span className="tl-values num">
            <span className="tl-old">{formatChangeValue(item.field, item.oldValue)}</span>
            <span className="tl-arrow" aria-hidden="true">→</span>
            <span className="tl-new">{formatChangeValue(item.field, item.newValue)}</span>
          </span>
        </div>
        {item.note ? <div className="tl-note">{item.note}</div> : null}
      </div>
    </li>
  );
}

export default function ChangelogPage() {
  const { selectedClientId } = useClients();
  const path = `/changelog${selectedClientId ? `?clientId=${encodeURIComponent(selectedClientId)}` : ''}`;
  const changelog = useApi<ChangeLogDto[]>(path);
  const items = changelog.data ?? [];

  return (
    <>
      <div className="page-h">
        <h1>変更履歴</h1>
        <span className="sub">ADGRID経由の変更と媒体側の変更を統合して記録します。実績の変動要因の特定に使えます</span>
      </div>

      {changelog.error ? <ErrorCard error={changelog.error} onRetry={changelog.retry} /> : null}

      {changelog.loading ? (
        <div className="card">
          <div className="c-body"><SkeletonLines count={6} /></div>
        </div>
      ) : null}

      {items.length > 0 ? (
        <div className="card">
          <div className="c-body">
            <ol className="timeline">
              {items.map((item) => (
                <ChangeRow key={item.id} item={item} />
              ))}
            </ol>
          </div>
        </div>
      ) : null}

      {changelog.data && items.length === 0 ? (
        <EmptyState
          title="変更履歴はまだありません"
          sub="承認フローでの適用や媒体同期が記録されます。"
        />
      ) : null}
    </>
  );
}
