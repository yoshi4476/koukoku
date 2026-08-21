'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { MeDto } from '@adgrid/shared';
import { apiPost, ApiError, toApiError } from '@/lib/api';
import { ErrorCard } from '@/components/ui';

export default function SignupPage() {
  const router = useRouter();
  const [tenantName, setTenantName] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (password.length < 8) {
      setError(
        new ApiError('パスワードが8文字未満です。', '8文字以上のパスワードを設定してください。'),
      );
      return;
    }
    setSubmitting(true);
    setError(null);
    apiPost<MeDto>('/auth/signup', { email, password, name, tenantName })
      .then(() => router.replace('/onboarding'))
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
        <h1 className="auth-title">14日間、すべての機能を無料で試せます</h1>
        <p className="auth-sub">クレジットカード登録は不要です。</p>

        {error ? <ErrorCard error={error} /> : null}

        <form className="form-grid" onSubmit={submit}>
          <div className="field">
            <label htmlFor="signup-tenant">会社名</label>
            <input
              id="signup-tenant"
              className="input"
              type="text"
              autoComplete="organization"
              required
              value={tenantName}
              onChange={(e) => setTenantName(e.target.value)}
              placeholder="例: リンクデザイン株式会社"
            />
          </div>
          <div className="field">
            <label htmlFor="signup-name">お名前</label>
            <input
              id="signup-name"
              className="input"
              type="text"
              autoComplete="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例: 山田 太郎"
            />
          </div>
          <div className="field">
            <label htmlFor="signup-email">メールアドレス</label>
            <input
              id="signup-email"
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
            <label htmlFor="signup-password">パスワード (8文字以上)</label>
            <input
              id="signup-password"
              className="input"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <button type="submit" className="btn pri" disabled={submitting} style={{ justifyContent: 'center' }}>
            {submitting ? 'アカウントを作成中…' : '無料で始める'}
          </button>
        </form>

        <p className="auth-alt">
          すでにアカウントをお持ちの方は <Link href="/login">ログインする</Link>
        </p>
      </div>
    </div>
  );
}
