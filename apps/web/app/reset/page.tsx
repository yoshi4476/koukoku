'use client';

import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { apiGet, apiPost, ApiError, toApiError } from '@/lib/api';
import { ErrorCard, SkeletonLines } from '@/components/ui';

function ResetForm() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get('token') ?? '';
  const [checking, setChecking] = useState(true);
  const [valid, setValid] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  // 入力してから「リンクが無効」と言われるのを避けるため、開いた時点で確認する
  useEffect(() => {
    if (!token) { setChecking(false); return; }
    apiGet<{ valid: boolean }>(`/auth/reset?token=${encodeURIComponent(token)}`)
      .then((r) => setValid(r.valid))
      .catch(() => setValid(false))
      .finally(() => setChecking(false));
  }, [token]);

  const mismatch = confirm.length > 0 && password !== confirm;
  const tooShort = password.length > 0 && password.length < 8;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (submitting || mismatch || tooShort) return;
    setSubmitting(true);
    setError(null);
    apiPost<{ ok: boolean }>('/auth/reset', { token, password })
      .then(() => {
        setDone(true);
        setTimeout(() => router.replace('/login'), 2500);
      })
      .catch((err: unknown) => setError(toApiError(err)))
      .finally(() => setSubmitting(false));
  };

  if (checking) return <SkeletonLines count={3} />;

  if (!token || !valid) {
    return (
      <>
        <div className="alert bad" style={{ marginBottom: 14 }}>
          このリンクは使用できません。有効期限が切れているか、既に使用済みです。
          <br />
          お手数ですが、もう一度パスワード再設定をやり直してください。
        </div>
        <p className="auth-alt">
          <Link href="/forgot">パスワード再設定をやり直す</Link>
        </p>
      </>
    );
  }

  if (done) {
    return (
      <>
        <div className="alert info" style={{ marginBottom: 14 }}>
          パスワードを変更しました。ログイン画面に移動します…
          <br />
          安全のため、これまでのログイン状態はすべて解除されました。
        </div>
        <p className="auth-alt">
          <Link href="/login">ログイン画面へ</Link>
        </p>
      </>
    );
  }

  return (
    <>
      {error ? <ErrorCard error={error} /> : null}
      <form className="form-grid" onSubmit={submit}>
        <div className="field">
          <label htmlFor="rs-pw">新しいパスワード（8文字以上）</label>
          <input
            id="rs-pw"
            className="input"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {tooShort ? <span className="field-note bad">8文字以上にしてください。</span> : null}
        </div>
        <div className="field">
          <label htmlFor="rs-pw2">確認のためもう一度</label>
          <input
            id="rs-pw2"
            className="input"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
          {mismatch ? <span className="field-note bad">パスワードが一致しません。</span> : null}
        </div>
        <button
          type="submit"
          className="btn pri"
          disabled={submitting || mismatch || tooShort || password.length === 0}
          style={{ justifyContent: 'center' }}
        >
          {submitting ? '変更中…' : 'パスワードを変更する'}
        </button>
      </form>
    </>
  );
}

export default function ResetPage() {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          AD<span className="bx">GRID</span>
        </div>
        <h1 className="auth-title">新しいパスワードの設定</h1>
        <p className="auth-sub">新しいパスワードを入力してください。</p>
        <Suspense fallback={<SkeletonLines count={3} />}>
          <ResetForm />
        </Suspense>
      </div>
    </div>
  );
}
