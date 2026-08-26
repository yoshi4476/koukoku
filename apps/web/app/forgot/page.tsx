'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { apiPost, ApiError, toApiError } from '@/lib/api';
import { ErrorCard } from '@/components/ui';

export default function ForgotPage() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    apiPost<{ ok: boolean }>('/auth/forgot', { email })
      .then(() => setDone(true))
      .catch((err: unknown) => setError(toApiError(err)))
      .finally(() => setSubmitting(false));
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          AD<span className="bx">GRID</span>
        </div>
        <h1 className="auth-title">パスワードの再設定</h1>
        <p className="auth-sub">ご登録のメールアドレスに再設定用のリンクをお送りします。</p>

        {error ? <ErrorCard error={error} /> : null}

        {done ? (
          <>
            {/* 登録済みかどうかを伝えない (存在するメールを探る手口を防ぐため) */}
            <div className="alert info" style={{ marginBottom: 14 }}>
              受け付けました。登録されているメールアドレスであれば、再設定用のリンクをお送りします。
              数分たっても届かない場合は、迷惑メールフォルダをご確認いただくか、ご担当者にお問い合わせください。
            </div>
            <p className="auth-alt">
              <Link href="/login">ログイン画面に戻る</Link>
            </p>
          </>
        ) : (
          <>
            <form className="form-grid" onSubmit={submit}>
              <div className="field">
                <label htmlFor="fg-email">メールアドレス</label>
                <input
                  id="fg-email"
                  className="input"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.co.jp"
                />
              </div>
              <button type="submit" className="btn pri" disabled={submitting} style={{ justifyContent: 'center' }}>
                {submitting ? '送信中…' : '再設定リンクを送る'}
              </button>
            </form>
            <p className="auth-alt">
              <Link href="/login">ログイン画面に戻る</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
