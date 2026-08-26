'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { MeDto } from '@adgrid/shared';
import { apiPost, ApiError, toApiError } from '@/lib/api';
import { ErrorCard } from '@/components/ui';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    apiPost<MeDto>('/auth/login', { email, password })
      .then(() => router.replace('/'))
      .catch((err: unknown) => {
        setError(toApiError(err));
        setSubmitting(false);
      });
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          AD<span className="bx">GRID</span>
        </div>
        <h1 className="auth-title">ADGRIDにログイン</h1>
        <p className="auth-sub">広告運用の司令室へようこそ。</p>

        {error ? <ErrorCard error={error} /> : null}

        <form className="form-grid" onSubmit={submit}>
          <div className="field">
            <label htmlFor="login-email">メールアドレス</label>
            <input
              id="login-email"
              className="input"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.co.jp"
            />
          </div>
          <div className="field">
            <label htmlFor="login-password">パスワード</label>
            <input
              id="login-password"
              className="input"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button type="submit" className="btn pri" disabled={submitting} style={{ justifyContent: 'center' }}>
            {submitting ? 'ログイン中…' : 'ログインする'}
          </button>
        </form>

        <p className="auth-alt">
          <Link href="/forgot">パスワードをお忘れですか？</Link>
        </p>
        <p className="auth-alt">
          アカウントをお持ちでない方は <Link href="/signup">無料で始める</Link>
        </p>
        <p className="auth-demo">
          デモ環境 (パスワード共通 <b>demo-pass-2026</b>):<br />
          自社運用版 <b>demo@adgrid.jp</b> / 提供先版 <b>client@adgrid.jp</b><br />
          提供先アクセス(A社限定) <b>clienta@adgrid.jp</b>
        </p>
      </div>
    </div>
  );
}
