'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { Edition, HomeDto, HomeTaskDto, MeDto, OnboardingStatusDto, TaskKind } from '@adgrid/shared';
import { EDITION_LABEL } from '@adgrid/shared';
import { useApi } from '@/components/use-api';
import { useAuth } from '@/components/auth-context';
import { ErrorCard, HintBar, PlatformTag, Skeleton } from '@/components/ui';
import { apiPost, apiPut, ApiError, toApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';

/** ホーム上部の表示モード切替 (自社運用版 / 提供先版)。オーナーのみ切替可 */
const EDITION_DESC: Record<Edition, string> = {
  agency: '全機能で運用',
  client: '自社データ閲覧中心',
};

function EditionModeBar({ onSwitched }: { onSwitched: () => void }) {
  const { me, setMe } = useAuth();
  const [saving, setSaving] = useState<Edition | null>(null);
  const canEdit = me.role === 'owner';
  const editions: Edition[] = ['agency', 'client'];

  const switchTo = (edition: Edition) => {
    if (edition === me.edition || saving || !canEdit) return;
    setSaving(edition);
    apiPut<MeDto>('/auth/edition', { edition })
      .then((updated) => {
        setMe(updated);
        onSwitched();
      })
      .catch(() => {})
      .finally(() => setSaving(null));
  };

  return (
    <div className="mode-bar">
      <span className="mode-bar-lab">表示モード</span>
      <div className="mode-seg" role="group" aria-label="表示モードの切替">
        {editions.map((e) => (
          <button
            key={e}
            type="button"
            className={`mode-opt${me.edition === e ? ' on' : ''}`}
            disabled={!canEdit || saving !== null}
            aria-pressed={me.edition === e}
            onClick={() => switchTo(e)}
          >
            {e === 'agency' ? '🏢' : '🤝'} {EDITION_LABEL[e]}
            {saving === e ? '…' : ''}
          </button>
        ))}
      </div>
      <span className="mode-bar-desc">{EDITION_DESC[me.edition]}</span>
      {!canEdit ? <span className="mode-bar-note">切替はオーナーのみ</span> : null}
    </div>
  );
}

const GROUPS: Array<{ kind: TaskKind; title: string }> = [
  { kind: 'alert', title: 'アラート' },
  { kind: 'ai_proposal', title: 'AI提案 (未読)' },
  { kind: 'approval', title: '承認待ち' },
  { kind: 'report', title: '今日のレポート予定' },
];

const ACTION_LABEL: Record<TaskKind, string> = {
  alert: '確認する',
  ai_proposal: '提案を見る',
  approval: '承認へ',
  report: '開く',
};

const ALERT_ID_PREFIX = 'alert-';

function TaskRow({
  task,
  acking,
  onAck,
}: {
  task: HomeTaskDto;
  acking: boolean;
  onAck: (eventId: string) => void;
}) {
  const primary = task.kind === 'ai_proposal' || task.kind === 'report';
  const eventId =
    task.kind === 'alert' && task.id.startsWith(ALERT_ID_PREFIX)
      ? task.id.slice(ALERT_ID_PREFIX.length)
      : null;
  return (
    <div className={`task sev-${task.severity}`}>
      <div className="t-body">
        <div className="t-title">{task.title}</div>
        <div className="t-sub">{task.subtitle}</div>
      </div>
      <div className="t-meta">
        <span className="tag">{task.clientName}</span>
        {task.platform ? <PlatformTag platform={task.platform} /> : null}
        <Link href={task.href} className={`btn sm ${primary ? 'pri' : 'sec'}`}>
          {ACTION_LABEL[task.kind]}
        </Link>
        {eventId ? (
          <button
            type="button"
            className="btn sm sec"
            onClick={() => onAck(eventId)}
            disabled={acking}
          >
            {acking ? '更新中…' : '確認済にする'}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function HomeSkeleton() {
  return (
    <div className="queue" aria-label="読み込み中">
      {Array.from({ length: 4 }, (_, i) => (
        <div className="task" key={i}>
          <div className="t-body">
            <Skeleton w="60%" h={14} style={{ marginBottom: 8 }} />
            <Skeleton w="40%" h={11} />
          </div>
          <Skeleton w={120} h={26} />
        </div>
      ))}
    </div>
  );
}

export default function HomePage() {
  const { data, loading, error, retry } = useApi<HomeDto>('/home');
  const onboarding = useApi<OnboardingStatusDto>('/onboarding/status');
  const needsSetup = onboarding.data?.needsOnboarding === true;
  const [ackingId, setAckingId] = useState<string | null>(null);
  const [ackError, setAckError] = useState<ApiError | null>(null);

  const ack = (eventId: string) => {
    if (ackingId !== null) return;
    setAckingId(eventId);
    setAckError(null);
    apiPost<{ ok: true }>(`/alerts/events/${eventId}/ack`, {})
      .then(() => {
        setAckingId(null);
        retry();
      })
      .catch((e: unknown) => {
        setAckError(toApiError(e));
        setAckingId(null);
      });
  };

  return (
    <>
      <EditionModeBar onSwitched={retry} />
      <div className="page-h">
        <h1>{data ? `${formatDate(data.date)} の司令室` : '今日の司令室'}</h1>
        {data ? (
          <span className="sub">
            対応済み <b className="num">{data.doneCount}</b>/<b className="num">{data.totalCount}</b> 件
          </span>
        ) : null}
      </div>

      <HintBar id="home" title="今日の司令室の使い方">
        この画面は<mark>今日やるべきこと</mark>だけを優先度順 (アラート→AI提案→レポート予定) に表示します。運用者の1日はここから始めましょう。各行のボタンから該当画面に直行できます。
      </HintBar>

      {error ? <ErrorCard error={error} onRetry={retry} /> : null}
      {ackError ? <ErrorCard error={ackError} /> : null}
      {loading ? <HomeSkeleton /> : null}

      {data && data.tasks.length === 0 ? (
        needsSetup ? (
          <div className="empty">
            <div className="e-title">初期セットアップを完了させましょう</div>
            <div className="e-sub">クライアント登録とデータ接続が済むと、ここに毎日のタスクが並びます。</div>
            <Link href="/onboarding" className="btn pri">セットアップを続ける</Link>
          </div>
        ) : (
          <div className="empty">
            <div className="e-title">今日は対応事項がありません</div>
            <div className="e-sub">アラート・AI提案・レポート予定はすべて対応済みです。</div>
            <Link href="/dashboard" className="btn pri">ダッシュボードを見る</Link>
          </div>
        )
      ) : null}

      {data
        ? GROUPS.map(({ kind, title }) => {
            const tasks = data.tasks.filter((t) => t.kind === kind);
            if (tasks.length === 0) return null;
            return (
              <section key={kind}>
                <div className="q-head">
                  <h2>{title}</h2>
                  <span className="cnt">{tasks.length}</span>
                </div>
                <div className="queue" style={{ marginBottom: 4 }}>
                  {tasks.map((t) => (
                    <TaskRow
                      key={t.id}
                      task={t}
                      acking={ackingId !== null && t.id === `${ALERT_ID_PREFIX}${ackingId}`}
                      onAck={ack}
                    />
                  ))}
                </div>
              </section>
            );
          })
        : null}
    </>
  );
}
