'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { ProposalDto, ProposalStatus } from '@adgrid/shared';
import { isApprover } from '@adgrid/shared';
import { useApi } from '@/components/use-api';
import { useAuth } from '@/components/auth-context';
import { EmptyState, ErrorCard, PlatformTag, Skeleton, SkeletonLines } from '@/components/ui';
import { apiPost, ApiError, toApiError } from '@/lib/api';
import { CONFIDENCE_LABEL, PROPOSAL_ACTION_LABEL, PROPOSAL_STATUS_LABEL } from '@/lib/labels';
import { formatDateTime } from '@/lib/format';

type BusyKind = 'approve' | 'reject' | 'rollback' | 'requeue';

interface Busy {
  id: string;
  kind: BusyKind;
}

/* ステータスピル配色: executed=緑 / failed=赤 / rejected・rolled_back=グレー */
const STATUS_PILL: Record<ProposalStatus, string> = {
  pending: 'warn',
  approved: 'ai',
  rejected: 'flat',
  executed: 'up',
  failed: 'down',
  rolled_back: 'flat',
};

/* ---- 承認待ちカード ---- */
function PendingCard({
  p,
  canApprove,
  busy,
  onAction,
}: {
  p: ProposalDto;
  canApprove: boolean;
  busy: Busy | null;
  onAction: (id: string, kind: BusyKind) => void;
}) {
  const actingKind = busy !== null && busy.id === p.id ? busy.kind : null;
  const locked = busy !== null || !canApprove;

  return (
    <div className="proposal">
      <div className="f-head">
        <span className="f-title">{p.title}</span>
        <span className="pill ai">{PROPOSAL_ACTION_LABEL[p.actionType]}</span>
        <span className={`pill ${p.confidence === 'high' ? 'ai' : 'flat'}`}>
          {CONFIDENCE_LABEL[p.confidence] ?? p.confidence}
        </span>
      </div>
      <div className="p-meta">
        <span>{p.clientName}</span>
        <PlatformTag platform={p.platform} />
        <span>{p.accountName}</span>
        <span className="num">申請 {formatDateTime(p.createdAt)}</span>
      </div>

      {/* 影響シミュレーション: 承認なしでは実行しない原則 (W-7) の判断材料として強調表示する */}
      <div className="sim-box">
        <span className="f-label">影響シミュレーション</span>
        {p.simulation}
      </div>

      {p.evidence ? (
        <div className="f-block">
          <span className="f-label">根拠</span>
          <span style={{ color: 'var(--ink-2)' }}>{p.evidence}</span>
        </div>
      ) : null}
      {p.risk ? (
        <div className="f-block">
          <span className="f-label">リスク</span>
          <span style={{ color: 'var(--ink-2)' }}>{p.risk}</span>
        </div>
      ) : null}

      <div className="f-actions">
        <button type="button" className="btn sm pri" disabled={locked} onClick={() => onAction(p.id, 'approve')}>
          {actingKind === 'approve' ? '実行中…' : '承認して実行'}
        </button>
        <button type="button" className="btn sm sec" disabled={locked} onClick={() => onAction(p.id, 'reject')}>
          {actingKind === 'reject' ? '処理中…' : '却下'}
        </button>
        {!canApprove ? (
          <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>承認はオーナー/管理者のみ行えます</span>
        ) : null}
      </div>
    </div>
  );
}

/* ---- 履歴の行 ---- */
function HistoryRow({
  p,
  busy,
  canApprove,
  onAction,
}: {
  p: ProposalDto;
  busy: Busy | null;
  canApprove: boolean;
  onAction: (id: string, kind: BusyKind) => void;
}) {
  const active = (kind: BusyKind) => busy !== null && busy.id === p.id && busy.kind === kind;

  return (
    <div className="prop-row">
      <span className={`pill ${STATUS_PILL[p.status]}`}>{PROPOSAL_STATUS_LABEL[p.status]}</span>
      <span className="tag">{PROPOSAL_ACTION_LABEL[p.actionType]}</span>
      <span className="pr-title">{p.title}</span>
      {p.executionNote ? (
        <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{p.executionNote}</span>
      ) : null}
      <span className="num" style={{ marginLeft: 'auto', color: 'var(--muted)' }}>
        {formatDateTime(p.executedAt ?? p.approvedAt ?? p.createdAt)}
      </span>
      {canApprove && p.status === 'failed' ? (
        <button type="button" className="btn sm sec" disabled={busy !== null} onClick={() => onAction(p.id, 'requeue')}>
          {active('requeue') ? '実行中…' : '再試行する'}
        </button>
      ) : null}
      {canApprove && p.canRollback ? (
        <button type="button" className="btn sm sec" disabled={busy !== null} onClick={() => onAction(p.id, 'rollback')}>
          {active('rollback') ? '実行中…' : '元に戻す'}
        </button>
      ) : null}
    </div>
  );
}

export default function ApprovalsPage() {
  const { me } = useAuth();
  const canApprove = isApprover(me.role);
  const proposals = useApi<ProposalDto[]>('/proposals');
  const settings = useApi<{ applyEnabled: boolean }>('/proposals/settings');
  const [busy, setBusy] = useState<Busy | null>(null);
  const [actionError, setActionError] = useState<ApiError | null>(null);

  const act = (id: string, kind: BusyKind) => {
    if (busy) return;
    if (kind === 'rollback' && !window.confirm('この提案の変更を実行前の値に戻しますか？')) return;
    if (kind === 'requeue' && !window.confirm('この提案を承認待ちに戻して再試行しますか？')) return;
    setBusy({ id, kind });
    setActionError(null);
    apiPost<ProposalDto>(`/proposals/${id}/${kind}`, {})
      .then(() => {
        setBusy(null);
        proposals.retry();
      })
      .catch((e: unknown) => {
        setActionError(toApiError(e));
        setBusy(null);
        // サーバ状態と食い違わないよう再取得して同期する
        proposals.retry();
      });
  };

  const list = proposals.data ?? [];
  const pending = list.filter((p) => p.status === 'pending');
  const history = list.filter((p) => p.status !== 'pending');

  return (
    <>
      <div className="page-h">
        <h1>承認キュー</h1>
        <span className="sub">AIの提案を確認し、承認してから広告アカウントへ適用します</span>
      </div>

      {settings.loading ? <Skeleton h={20} w={260} style={{ marginBottom: 10 }} /> : null}
      {settings.error ? <ErrorCard error={settings.error} onRetry={settings.retry} /> : null}
      {settings.data && !settings.data.applyEnabled ? (
        <div className="alert warn" role="alert">
          <span className="a-ico" aria-hidden="true">●</span>
          <div>
            <span className="a-title">自動適用は停止中です</span>
            <br />
            <span className="a-body">
              停止中は承認・実行がすべてブロックされます。<Link href="/settings">設定画面で変更</Link>
            </span>
          </div>
        </div>
      ) : null}

      {actionError ? <ErrorCard error={actionError} /> : null}

      {proposals.loading ? (
        <div className="card">
          <div className="c-body"><SkeletonLines count={5} /></div>
        </div>
      ) : proposals.error ? (
        <ErrorCard error={proposals.error} onRetry={proposals.retry} />
      ) : (
        <>
          <div className="q-head">
            <h2>承認待ち</h2>
            <span className="cnt num">{pending.length}</span>
          </div>
          {pending.length === 0 ? (
            <EmptyState
              title="承認待ちの提案はありません"
              sub="AI診断から提案を作成できます。"
              action={<Link href="/audit" className="btn pri">AI診断へ</Link>}
            />
          ) : (
            pending.map((p) => (
              <PendingCard key={p.id} p={p} canApprove={canApprove} busy={busy} onAction={act} />
            ))
          )}

          <div className="q-head section-gap">
            <h2>履歴</h2>
            <span className="cnt num">{history.length}</span>
          </div>
          <div className="card">
            {history.length === 0 ? (
              <div className="c-body" style={{ color: 'var(--muted)', fontSize: 12.5 }}>まだ履歴がありません。</div>
            ) : (
              <div>
                {history.map((p) => (
                  <HistoryRow key={p.id} p={p} busy={busy} canApprove={canApprove} onAction={act} />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
