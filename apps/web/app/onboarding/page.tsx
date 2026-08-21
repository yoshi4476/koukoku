'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type {
  AdAccountDto,
  ClientDto,
  CsvImportResultDto,
  OnboardingStatusDto,
  Platform,
  SampleDataResultDto,
} from '@adgrid/shared';
import { ALL_PLATFORMS, PLATFORM_META } from '@adgrid/shared';
import { apiGet, apiPost, apiUpload, ApiAuthError, ApiError, toApiError } from '@/lib/api';
import { ErrorCard, Skeleton, SkeletonLines } from '@/components/ui';

const INDUSTRIES: Array<{ code: string; label: string }> = [
  { code: 'ec', label: 'EC・通販' },
  { code: 'beauty', label: '美容・サロン' },
  { code: 'saas', label: 'SaaS・IT' },
  { code: 'finance', label: '金融' },
  { code: 'hr', label: '人材' },
  { code: 'other', label: 'その他' },
];

const STEPS = [
  { n: 1, label: 'クライアント登録' },
  { n: 2, label: 'データ接続' },
  { n: 3, label: 'AI診断' },
];

type Phase = 'loading' | 'wizard' | 'done' | 'complete';

function StepIndicator({ step }: { step: number }) {
  return (
    <ol className="ob-steps">
      {STEPS.map((s, i) => (
        <li key={s.n} style={{ display: 'contents' }}>
          {i > 0 ? <span className="ob-arrow" aria-hidden="true">→</span> : null}
          <span className={`ob-step${step === s.n ? ' on' : ''}${step > s.n ? ' done' : ''}`}>
            <span className="ob-num">{step > s.n ? '✓' : s.n}</span>
            {s.label}
          </span>
        </li>
      ))}
    </ol>
  );
}

export default function OnboardingPage() {
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>('loading');
  const [statusError, setStatusError] = useState<ApiError | null>(null);
  const [statusTick, setStatusTick] = useState(0);
  const [step, setStep] = useState(1);

  const [clientId, setClientId] = useState('');
  const [adAccountId, setAdAccountId] = useState('');

  /* Step 1 */
  const [clientName, setClientName] = useState('');
  const [industry, setIndustry] = useState('ec');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<ApiError | null>(null);

  /* Step 2 */
  const [platform, setPlatform] = useState<Platform>('google_ads');
  const [accountName, setAccountName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<ApiError | null>(null);
  const [sampleRunning, setSampleRunning] = useState(false);
  const [sampleError, setSampleError] = useState<ApiError | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* Step 3 */
  const [auditRunning, setAuditRunning] = useState(false);
  const [auditError, setAuditError] = useState<ApiError | null>(null);
  const auditStartedRef = useRef(false);

  /* 再訪時は保存済みの進捗から続きを再開する */
  useEffect(() => {
    let alive = true;
    setStatusError(null);
    setPhase('loading');
    apiGet<OnboardingStatusDto>('/onboarding/status')
      .then(async (status) => {
        if (!alive) return;
        if (!status.needsOnboarding) {
          setPhase('complete');
          return;
        }
        if (status.clientCount > 0) {
          // 登録済みクライアントの続きから (最新の1件を対象にする)
          const clients = await apiGet<ClientDto[]>('/clients');
          if (!alive) return;
          const first = clients[0];
          if (first) {
            setClientId(first.id);
            setClientName(first.name);
            setStep(2);
          }
        }
        setPhase('wizard');
      })
      .catch((e: unknown) => {
        if (!alive) return;
        if (e instanceof ApiAuthError) {
          router.replace('/login');
          return;
        }
        setStatusError(toApiError(e));
        setPhase('wizard');
      });
    return () => {
      alive = false;
    };
  }, [router, statusTick]);

  /* Step 1: クライアント登録 */
  const createClient = (e: FormEvent) => {
    e.preventDefault();
    if (creating || !clientName.trim()) return;
    setCreating(true);
    setCreateError(null);
    apiPost<ClientDto>('/clients', { name: clientName.trim(), industryCode: industry })
      .then((c) => {
        setClientId(c.id);
        setCreating(false);
        setStep(2);
      })
      .catch((err: unknown) => {
        setCreateError(toApiError(err));
        setCreating(false);
      });
  };

  /* Step 2a: アカウント作成 → CSV取込 */
  const connectCsv = () => {
    if (connecting || !clientId || !file) return;
    setConnecting(true);
    setConnectError(null);
    apiPost<AdAccountDto>(`/clients/${clientId}/accounts`, {
      platform,
      name: accountName.trim() || undefined,
    })
      .then((account) => {
        const form = new FormData();
        form.append('file', file);
        form.append('adAccountId', account.id);
        return apiUpload<CsvImportResultDto>('/imports/csv', form).then(() => account.id);
      })
      .then((accountId) => {
        setAdAccountId(accountId);
        setConnecting(false);
        setStep(3);
      })
      .catch((err: unknown) => {
        setConnectError(toApiError(err));
        setConnecting(false);
      });
  };

  /* Step 2b: サンプルデータ → 診断まで一括実行して完了へ直行 */
  const runSample = () => {
    if (sampleRunning) return;
    setSampleRunning(true);
    setSampleError(null);
    apiPost<SampleDataResultDto>('/onboarding/sample', {})
      .then((r) => {
        setClientId(r.clientId);
        setAdAccountId(r.adAccountId);
        setSampleRunning(false);
        setPhase('done');
      })
      .catch((err: unknown) => {
        setSampleError(toApiError(err));
        setSampleRunning(false);
      });
  };

  /* Step 3: 初回AI診断を自動実行 */
  const runAudit = useCallback(() => {
    if (!adAccountId) return;
    setAuditRunning(true);
    setAuditError(null);
    apiPost('/audits/run', { adAccountId })
      .then(() => {
        setAuditRunning(false);
        setPhase('done');
      })
      .catch((err: unknown) => {
        setAuditError(toApiError(err));
        setAuditRunning(false);
      });
  }, [adAccountId]);

  useEffect(() => {
    if (step === 3 && adAccountId && !auditStartedRef.current) {
      auditStartedRef.current = true;
      runAudit();
    }
  }, [step, adAccountId, runAudit]);

  const auditHref = `/audit?clientId=${encodeURIComponent(clientId)}&accountId=${encodeURIComponent(adAccountId)}`;

  return (
    <div className="ob-page">
      <div className="ob-inner">
        <div className="ob-brand">
          AD<span className="bx">GRID</span>
        </div>

        {phase === 'loading' ? (
          <div className="ob-card" aria-label="読み込み中">
            <Skeleton w="40%" h={16} style={{ marginBottom: 14 }} />
            <SkeletonLines count={4} />
          </div>
        ) : null}

        {phase === 'complete' ? (
          <div className="ob-card ob-done">
            <div className="ob-emoji" aria-hidden="true">✅</div>
            <h1 className="ob-title">初期セットアップは完了しています</h1>
            <p className="ob-sub">ホームの「今日の司令室」から日々の運用を始められます。</p>
            <Link href="/" className="btn pri">ホームを開く</Link>
          </div>
        ) : null}

        {phase === 'done' ? (
          <div className="ob-card ob-done">
            <h1 className="ob-title">診断が完了しました 🎉</h1>
            <p className="ob-sub">AIが実績データから改善点を優先度順にまとめました。</p>
            <Link href={auditHref} className="btn pri">診断結果を見る</Link>
          </div>
        ) : null}

        {phase === 'wizard' ? (
          <>
            <StepIndicator step={step} />

            {statusError ? (
              <ErrorCard error={statusError} onRetry={() => setStatusTick((t) => t + 1)} />
            ) : null}

            {step === 1 ? (
              <div className="ob-card">
                <h1 className="ob-title">はじめに、担当クライアントを登録しましょう</h1>
                <p className="ob-sub">3ステップ・約10分で最初のAI診断まで完了します。</p>

                {createError ? <ErrorCard error={createError} /> : null}

                <form className="form-grid" onSubmit={createClient}>
                  <div className="field">
                    <label htmlFor="ob-client-name">クライアント名</label>
                    <input
                      id="ob-client-name"
                      className="input"
                      type="text"
                      required
                      value={clientName}
                      onChange={(e) => setClientName(e.target.value)}
                      placeholder="例: 株式会社サンプル"
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="ob-industry">業種</label>
                    <select
                      id="ob-industry"
                      className="select"
                      value={industry}
                      onChange={(e) => setIndustry(e.target.value)}
                    >
                      {INDUSTRIES.map((ind) => (
                        <option key={ind.code} value={ind.code}>{ind.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <button type="submit" className="btn pri" disabled={creating || !clientName.trim()}>
                      {creating ? '登録中…' : 'クライアントを登録'}
                    </button>
                  </div>
                </form>
              </div>
            ) : null}

            {step === 2 ? (
              <div className="ob-card">
                <h1 className="ob-title">実績データを接続しましょう</h1>
                <p className="ob-sub">
                  {clientName ? `${clientName} の` : ''}実績データを取り込むと、AI診断とレポートが使えます。
                </p>

                {connectError ? <ErrorCard error={connectError} onRetry={connectCsv} /> : null}
                {sampleError ? <ErrorCard error={sampleError} onRetry={runSample} /> : null}

                <div className="ob-choice">
                  <div className="ob-option">
                    <h3>CSVをアップロードする</h3>
                    <p className="ob-note" style={{ margin: 0 }}>
                      媒体管理画面の日別レポートCSVをそのまま使えます。
                    </p>
                    <div className="field">
                      <label htmlFor="ob-platform">媒体</label>
                      <select
                        id="ob-platform"
                        className="select"
                        value={platform}
                        onChange={(e) => setPlatform(e.target.value as Platform)}
                        disabled={connecting}
                      >
                        {ALL_PLATFORMS.map((p) => (
                          <option key={p} value={p}>{PLATFORM_META[p].label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label htmlFor="ob-account-name">アカウント名</label>
                      <input
                        id="ob-account-name"
                        className="input"
                        type="text"
                        value={accountName}
                        onChange={(e) => setAccountName(e.target.value)}
                        placeholder="例: メインアカウント"
                        disabled={connecting}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="ob-file">CSVファイル</label>
                      <input
                        id="ob-file"
                        ref={fileInputRef}
                        className="input"
                        type="file"
                        accept=".csv,text/csv"
                        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                        disabled={connecting}
                      />
                    </div>
                    <div>
                      <button
                        type="button"
                        className="btn pri"
                        onClick={connectCsv}
                        disabled={connecting || sampleRunning || !file}
                      >
                        {connecting ? '取込中…' : 'CSVを取り込む'}
                      </button>
                    </div>
                  </div>

                  <div className="ob-option">
                    <h3>まずは試してみる</h3>
                    <p className="ob-note" style={{ margin: 0 }}>
                      デモ用の実績データを自動作成し、AI診断まで一括で実行します。
                      手元にCSVが無くてもすぐに体験できます。
                    </p>
                    <div style={{ marginTop: 'auto' }}>
                      <button
                        type="button"
                        className="btn sec"
                        onClick={runSample}
                        disabled={sampleRunning || connecting}
                      >
                        {sampleRunning ? 'サンプルを準備中…' : 'サンプルデータで試す'}
                      </button>
                    </div>
                  </div>
                </div>

                {sampleRunning ? (
                  <div style={{ marginTop: 14 }}>
                    <p style={{ margin: '0 0 10px', fontWeight: 600, color: 'var(--primary)' }}>
                      サンプルデータを作成して診断を実行中… 約1分
                    </p>
                    <SkeletonLines count={3} />
                  </div>
                ) : null}
              </div>
            ) : null}

            {step === 3 ? (
              <div className="ob-card">
                <h1 className="ob-title">最初のAI診断を実行します</h1>
                <p className="ob-sub">取り込んだ実績データをAIが分析し、改善点を優先度順に提案します。</p>

                {auditError ? <ErrorCard error={auditError} onRetry={runAudit} /> : null}

                {auditRunning ? (
                  <div>
                    <p style={{ margin: '0 0 10px', fontWeight: 600, color: 'var(--primary)' }}>
                      実績データを分析中… 約1分
                    </p>
                    <SkeletonLines count={5} />
                  </div>
                ) : null}
              </div>
            ) : null}

            <p className="ob-foot">
              セットアップは途中で離れても、次回この画面から続きを再開できます。
              <Link href="/">ホームに戻る</Link>
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}
