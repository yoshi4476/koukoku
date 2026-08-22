'use client';

import { useState, type FormEvent } from 'react';
import type { CreateFeedbackInput, FeedbackDto } from '@adgrid/shared';
import { useApi } from '@/components/use-api';
import { useAuth } from '@/components/auth-context';
import { EmptyState, ErrorCard, HintBar, SkeletonLines } from '@/components/ui';
import { apiPost, ApiError, toApiError } from '@/lib/api';
import { formatDateTime } from '@/lib/format';

/* 提供先(client)ユーザー: フィードバックを送る */
function ClientFeedback() {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy || !message.trim()) return;
    setBusy(true);
    setError(null);
    const body: CreateFeedbackInput = { message: message.trim() };
    apiPost<FeedbackDto>('/feedback', body)
      .then(() => { setDone(true); setMessage(''); })
      .catch((err: unknown) => setError(toApiError(err)))
      .finally(() => setBusy(false));
  };

  return (
    <>
      <div className="page-h">
        <h1>フィードバック</h1>
        <span className="sub">運用担当への要望・質問・気づきを送れます</span>
      </div>
      <HintBar id="feedback-client" title="フィードバックの使い方">
        広告について<mark>気づいたこと・要望・質問</mark>を運用担当に送れます。「もっとこうしてほしい」「この訴求を試したい」など、なんでもお気軽にどうぞ。
      </HintBar>
      <form className="card" style={{ maxWidth: 640 }} onSubmit={submit}>
        <div className="c-body form-grid">
          {error ? <ErrorCard error={error} /> : null}
          {done ? (
            <div className="fb-done">✓ 送信しました。運用担当が確認します。<button type="button" className="btn sm sec" style={{ marginLeft: 10 }} onClick={() => setDone(false)}>続けて送る</button></div>
          ) : (
            <>
              <div className="field">
                <label htmlFor="fb-msg">メッセージ</label>
                <textarea id="fb-msg" className="textarea" rows={5} value={message} onChange={(e) => setMessage(e.target.value)}
                  placeholder="例: 春の新作をもっと前面に出したいです。動画クリエイティブも試せますか？" required />
              </div>
              <div className="f-actions">
                <button type="submit" className="btn pri" disabled={busy || !message.trim()}>{busy ? '送信中…' : '送信する'}</button>
              </div>
            </>
          )}
        </div>
      </form>
    </>
  );
}

/* 自社(運用): 受け取ったフィードバックを確認 */
function AgencyFeedback() {
  const list = useApi<FeedbackDto[]>('/feedback');
  const [resolving, setResolving] = useState<string | null>(null);

  const resolve = (id: string) => {
    setResolving(id);
    apiPost<FeedbackDto>(`/feedback/${id}/resolve`, {})
      .then(() => list.retry())
      .catch(() => undefined)
      .finally(() => setResolving(null));
  };

  const items = list.data ?? [];
  return (
    <>
      <div className="page-h">
        <h1>フィードバック</h1>
        <span className="sub">提供先(クライアント)から届いた要望・質問</span>
      </div>
      <HintBar id="feedback-agency" title="フィードバックの使い方">
        <mark>提供先アクセス</mark>のクライアントから届いたフィードバックの一覧です。対応したら「対応済みにする」でクローズできます。
      </HintBar>
      {list.error ? <ErrorCard error={list.error} onRetry={list.retry} /> : null}
      {list.loading ? <div className="card"><div className="c-body"><SkeletonLines count={3} /></div></div> : null}
      {list.data && items.length === 0 ? (
        <EmptyState title="まだフィードバックはありません" sub="クライアントに提供先アクセスを発行すると、ここに要望や質問が届きます。" />
      ) : null}
      {items.length > 0 ? (
        <div className="fb-list">
          {items.map((f) => (
            <div key={f.id} className={`fb-item ${f.status}`}>
              <div className="fb-head">
                <span className="fb-client">{f.clientName}</span>
                <span className="fb-author">{f.authorName}</span>
                <span className={`pill ${f.status === 'resolved' ? 'up' : 'warn'}`} style={{ marginLeft: 'auto' }}>
                  {f.status === 'resolved' ? '対応済み' : '未対応'}
                </span>
              </div>
              <div className="fb-msg">{f.message}</div>
              <div className="fb-foot">
                <span className="fb-date">{formatDateTime(f.createdAt)}</span>
                {f.status !== 'resolved' ? (
                  <button className="btn sm sec" disabled={resolving === f.id} onClick={() => resolve(f.id)}>対応済みにする</button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}

export default function FeedbackPage() {
  const { me } = useAuth();
  return me.clientScopeId ? <ClientFeedback /> : <AgencyFeedback />;
}
