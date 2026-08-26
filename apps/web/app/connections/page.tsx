'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import type {
  AuthorizeResultDto,
  ConnectionDto,
  Platform,
  SyncResultDto,
} from '@adgrid/shared';
import { ALL_PLATFORMS, PLATFORM_META } from '@adgrid/shared';
import { useApi } from '@/components/use-api';
import { useClients } from '@/components/client-context';
import { ErrorCard, HintBar, SkeletonLines } from '@/components/ui';
import { apiDelete, apiPost, ApiError, toApiError } from '@/lib/api';
import { CONNECTION_STATUS_META, PLATFORM_COLOR_VAR } from '@/lib/labels';
import { formatDateTime, formatNumber, formatPeriod } from '@/lib/format';

const STEPS = [
  { n: 1, label: '媒体を選ぶ' },
  { n: 2, label: '認証する' },
  { n: 3, label: 'アカウントを選ぶ' },
];

function StepIndicator({ step }: { step: number }) {
  return (
    <ol className="ob-steps" style={{ justifyContent: 'flex-start' }}>
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

function InfoAlert({ title, body }: { title: string; body?: string }) {
  return (
    <div className="alert info">
      <span className="a-ico" aria-hidden="true">●</span>
      <div>
        <span className="a-title">{title}</span>
        {body ? (
          <>
            <br />
            <span className="a-body">{body}</span>
          </>
        ) : null}
      </div>
    </div>
  );
}

/* ---- 上段: 接続済み一覧 ---- */
function ConnectionRow({
  conn,
  busy,
  onSync,
  onDisconnect,
}: {
  conn: ConnectionDto;
  busy: { id: string; kind: 'sync' | 'disconnect' } | null;
  onSync: (c: ConnectionDto) => void;
  onDisconnect: (c: ConnectionDto) => void;
}) {
  const status = CONNECTION_STATUS_META[conn.status];
  const mine = busy?.id === conn.id;
  return (
    <div className="conn-row">
      <div className="cn-head">
        <span className="dot" style={{ background: PLATFORM_COLOR_VAR[conn.platform] }} />
        {PLATFORM_META[conn.platform].label}
      </div>
      <span className="cn-status">
        <span className="sig" style={{ background: status.colorVar }} aria-hidden="true" />
        {status.label}
      </span>
      {conn.mode === 'mock' ? (
        <span className="pill warn" title="実APIの認証情報が未設定のためデモデータで同期しています">デモ接続</span>
      ) : null}
      <span className="cn-sync num">
        最終同期 {formatDateTime(conn.lastSyncedAt)}
        {conn.lastSyncedAt ? ` · 前回 ${formatNumber(conn.lastSyncRows)}行` : ''}
        {` · アカウント ${formatNumber(conn.accountCount)}件`}
      </span>
      <div className="cn-actions">
        <button
          type="button"
          className="btn sm sec"
          disabled={busy !== null}
          onClick={() => onSync(conn)}
        >
          {mine && busy?.kind === 'sync' ? '同期中…' : '今すぐ同期'}
        </button>
        <button
          type="button"
          className="btn sm sec"
          disabled={busy !== null}
          onClick={() => onDisconnect(conn)}
        >
          {mine && busy?.kind === 'disconnect' ? '切断中…' : '切断'}
        </button>
      </div>
      {conn.status === 'error' && conn.errorMessage ? (
        <div className="cn-err">原因: {conn.errorMessage}</div>
      ) : null}
    </div>
  );
}

/* ---- Step 3 の候補アカウント行 ---- */
interface CandidateRow {
  externalAccountId: string;
  name: string;
  checked: boolean;
  clientId: string;
  monthlyBudget: string;
}

export default function ConnectionsPage() {
  const router = useRouter();
  const { clients } = useClients();
  const connections = useApi<ConnectionDto[]>('/connections');

  /* 一覧の行アクション */
  const [busy, setBusy] = useState<{ id: string; kind: 'sync' | 'disconnect' } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [rowError, setRowError] = useState<ApiError | null>(null);

  /* ウィザード */
  const [step, setStep] = useState(1);
  const authReqId = useRef(0); // 認可リクエストの世代。古い応答の反映を防ぐ
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [authorizing, setAuthorizing] = useState(false);
  const [authError, setAuthError] = useState<ApiError | null>(null);
  const [authResult, setAuthResult] = useState<AuthorizeResultDto | null>(null);
  const [rows, setRows] = useState<CandidateRow[]>([]);
  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState<ApiError | null>(null);
  const [done, setDone] = useState<{ platform: Platform; rows: number } | null>(null);

  const connected = (connections.data ?? []).filter(
    (c) => c.accountCount > 0 || c.status !== 'not_connected',
  );
  const connectedPlatforms = new Set(
    (connections.data ?? []).filter((c) => c.status === 'connected').map((c) => c.platform),
  );

  const runSync = (c: ConnectionDto) => {
    if (busy) return;
    setBusy({ id: c.id, kind: 'sync' });
    setNotice(null);
    setRowError(null);
    apiPost<SyncResultDto>(`/connections/${c.id}/sync`, {})
      .then((r) => {
        setNotice(
          `${PLATFORM_META[c.platform].label}: ${formatNumber(r.rows)}行を同期しました (期間 ${formatPeriod(r.since, r.until)})`,
        );
        setBusy(null);
        connections.retry();
      })
      .catch((e: unknown) => {
        setRowError(toApiError(e));
        setBusy(null);
      });
  };

  const disconnect = (c: ConnectionDto) => {
    if (busy) return;
    const label = PLATFORM_META[c.platform].label;
    if (!window.confirm(`${label} との接続を切断しますか？\n取得済みの実績データと広告アカウントは保持されます。`)) return;
    setBusy({ id: c.id, kind: 'disconnect' });
    setNotice(null);
    setRowError(null);
    apiDelete<{ ok: true }>(`/connections/${c.id}`)
      .then(() => {
        setNotice(`${label} との接続を切断しました。実績データとアカウントは保持されています。`);
        setBusy(null);
        connections.retry();
      })
      .catch((e: unknown) => {
        setRowError(toApiError(e));
        setBusy(null);
      });
  };

  /* Step 1 → 2: 媒体選択で認可開始 */
  const authorize = (p: Platform) => {
    const my = ++authReqId.current;
    setAuthorizing(true);
    setAuthError(null);
    setAuthResult(null);
    apiPost<AuthorizeResultDto>(`/connections/${p}/authorize`, {})
      .then((r) => {
        // ウィザードを戻る/リセットした後に古い認可応答が届いて step3 を強制するのを防ぐ
        if (my !== authReqId.current) return;
        setAuthResult(r);
        setAuthorizing(false);
        if (r.mode === 'mock') {
          // デモ接続は認可画面を経由せず候補一覧へ自動進行する
          setRows(
            (r.candidates ?? []).map((cand) => ({
              externalAccountId: cand.externalAccountId,
              name: cand.name,
              checked: false,
              clientId: '',
              monthlyBudget: '',
            })),
          );
          setStep(3);
        }
      })
      .catch((e: unknown) => {
        if (my !== authReqId.current) return;
        setAuthError(toApiError(e));
        setAuthorizing(false);
      });
  };

  const selectPlatform = (p: Platform) => {
    if (PLATFORM_META[p].apiAvailability === 'partner_only') {
      // LINE は認定パートナー限定のため CSV 連携へ誘導する
      router.push('/import');
      return;
    }
    setPlatform(p);
    setStep(2);
    authorize(p);
  };

  const resetWizard = () => {
    authReqId.current++; // 進行中の認可応答を無効化する (戻った後に step3 へ飛ばされない)
    setStep(1);
    setPlatform(null);
    setAuthorizing(false);
    setAuthError(null);
    setAuthResult(null);
    setRows([]);
    setCompleting(false);
    setCompleteError(null);
    setDone(null);
  };

  const updateRow = (id: string, patch: Partial<CandidateRow>) => {
    setRows((prev) => prev.map((r) => (r.externalAccountId === id ? { ...r, ...patch } : r)));
  };

  const checkedRows = rows.filter((r) => r.checked);
  const canComplete =
    checkedRows.length > 0 && checkedRows.every((r) => r.clientId !== '') && !completing;

  const complete = () => {
    if (!platform || !canComplete) return;
    setCompleting(true);
    setCompleteError(null);
    const accounts = checkedRows.map((r) => {
      const budget = Number(r.monthlyBudget);
      return {
        externalAccountId: r.externalAccountId,
        name: r.name,
        clientId: r.clientId,
        monthlyBudget: r.monthlyBudget.trim() !== '' && Number.isFinite(budget) && budget > 0 ? budget : undefined,
      };
    });
    apiPost<{ connection: ConnectionDto; sync: SyncResultDto }>(
      `/connections/${platform}/complete`,
      { accounts },
    )
      .then((r) => {
        setCompleting(false);
        setDone({ platform: r.connection.platform, rows: r.sync.rows });
        connections.retry();
      })
      .catch((e: unknown) => {
        setCompleteError(toApiError(e));
        setCompleting(false);
      });
  };

  return (
    <>
      <div className="page-h">
        <h1>API接続</h1>
        <span className="sub">媒体APIとの接続・自動同期・切断の管理</span>
      </div>

      <HintBar id="connections" title="API接続の使い方">
        媒体を接続すると実績が<mark>3時間ごとに自動同期</mark>されます。3ステップのウィザードで接続。実APIの認証情報が未設定の間は<mark>デモ接続</mark>で動作を体験できます。LINEはAPI未提供のためCSV連携を。
      </HintBar>

      {/* ---- 上段: 接続済み ---- */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="c-head"><h2>接続済み</h2></div>
        {notice ? (
          <div className="c-body" style={{ paddingBottom: 0 }}>
            <InfoAlert title={notice} />
          </div>
        ) : null}
        {rowError ? (
          <div className="c-body" style={{ paddingBottom: 0 }}>
            <ErrorCard error={rowError} />
          </div>
        ) : null}
        {connections.loading ? (
          <div className="c-body"><SkeletonLines count={3} /></div>
        ) : connections.error ? (
          <div className="c-body"><ErrorCard error={connections.error} onRetry={connections.retry} /></div>
        ) : connected.length === 0 ? (
          <div className="c-body">
            <div className="empty">
              <div className="e-title">まだ媒体を接続していません</div>
              <div className="e-sub">接続すると実績データを自動同期し、AI診断・レポートに反映できます。</div>
              <a href="#conn-new" className="btn pri">接続を開始する</a>
            </div>
          </div>
        ) : (
          <div>
            {connected.map((c) => (
              <ConnectionRow key={c.id} conn={c} busy={busy} onSync={runSync} onDisconnect={disconnect} />
            ))}
          </div>
        )}
      </div>

      {/* ---- 下段: 新しく接続する (3ステップウィザード) ---- */}
      <div className="card" id="conn-new">
        <div className="c-head"><h2>新しく接続する</h2></div>
        <div className="c-body">
          {done ? (
            <div className="ob-done" style={{ padding: '24px 16px' }}>
              <h3 className="ob-title">接続が完了しました 🎉</h3>
              <p className="ob-sub">
                {PLATFORM_META[done.platform].label}の直近30日分・{formatNumber(done.rows)}行を同期しました。
                以後は3時間ごとに自動同期されます。
              </p>
              <div className="row-actions" style={{ justifyContent: 'center' }}>
                <Link href="/projects" className="btn pri">プロジェクトを見る</Link>
                <button type="button" className="btn sec" onClick={resetWizard}>続けて別の媒体を接続</button>
              </div>
            </div>
          ) : (
            <>
              <StepIndicator step={step} />

              {step === 1 ? (
                <>
                  <p className="ob-sub">接続する媒体を選んでください。認証からデータ同期まで約1分で完了します。</p>
                  {connections.loading ? (
                    <SkeletonLines count={3} />
                  ) : (
                    <div className="conn-pick">
                      {ALL_PLATFORMS.map((p) => {
                        const meta = PLATFORM_META[p];
                        const isConnected = connectedPlatforms.has(p);
                        const partnerOnly = meta.apiAvailability === 'partner_only';
                        return (
                          <button
                            key={p}
                            type="button"
                            className="conn-tile"
                            disabled={isConnected}
                            onClick={() => selectPlatform(p)}
                            title={partnerOnly ? 'CSV取込画面へ移動します' : undefined}
                          >
                            <span className="ct-head">
                              <span className="dot" style={{ background: PLATFORM_COLOR_VAR[p] }} />
                              {meta.label}
                            </span>
                            {isConnected ? (
                              <span className="ct-note ok">接続済み</span>
                            ) : partnerOnly ? (
                              <span className="ct-note warn">API未提供 — CSV連携で代替</span>
                            ) : (
                              <span className="ct-note">API接続に対応</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </>
              ) : null}

              {step === 2 && platform ? (
                <>
                  <p className="ob-sub">{PLATFORM_META[platform].label}の認証情報を確認しています。</p>
                  {authError ? (
                    <ErrorCard error={authError} onRetry={() => authorize(platform)} />
                  ) : null}
                  {authorizing ? (
                    <div>
                      <p style={{ margin: '0 0 10px', fontWeight: 600, color: 'var(--primary)' }}>
                        認証方式を確認中…
                      </p>
                      <SkeletonLines count={2} />
                    </div>
                  ) : null}
                  {!authorizing && authResult?.mode === 'oauth' && authResult.authUrl ? (
                    <div className="form-grid">
                      <InfoAlert
                        title="媒体の認可画面で連携を許可してください"
                        body="許可が完了すると、この画面に戻ってアカウント選択に進みます。"
                      />
                      <div>
                        <a className="btn pri" href={authResult.authUrl} target="_blank" rel="noopener noreferrer">
                          認可画面を開く
                        </a>
                      </div>
                    </div>
                  ) : null}
                  <div style={{ marginTop: 14 }}>
                    <button type="button" className="btn sm sec" onClick={resetWizard} disabled={authorizing}>
                      媒体選択に戻る
                    </button>
                  </div>
                </>
              ) : null}

              {step === 3 && platform ? (
                <>
                  <p className="ob-sub">
                    同期するアカウントを選び、担当クライアントに割り当ててください。
                  </p>
                  {authResult?.mode === 'mock' ? (
                    <InfoAlert
                      title="デモ接続モードで進みます (実APIの認証情報は未設定です)"
                      body="デモデータで接続の流れを体験できます。実APIの認証情報を設定すると本番接続に切り替わります。"
                    />
                  ) : null}
                  {completeError ? <ErrorCard error={completeError} onRetry={complete} /> : null}

                  {rows.length === 0 ? (
                    <div className="empty">
                      <div className="e-title">接続できるアカウントが見つかりません</div>
                      <div className="e-sub">媒体側でアカウント権限を確認し、もう一度認証してください。</div>
                      <button type="button" className="btn pri" onClick={() => authorize(platform)}>再認証する</button>
                    </div>
                  ) : (
                    <div>
                      {rows.map((r) => (
                        <div key={r.externalAccountId} className={`conn-acct${r.checked ? ' on' : ''}`}>
                          <label className="ca-main">
                            <input
                              type="checkbox"
                              checked={r.checked}
                              onChange={(e) => updateRow(r.externalAccountId, { checked: e.target.checked })}
                              disabled={completing}
                            />
                            <span>{r.name}</span>
                            <span className="ca-id num">{r.externalAccountId}</span>
                          </label>
                          {r.checked ? (
                            <div className="ca-assign">
                              <div className="field">
                                <label htmlFor={`ca-client-${r.externalAccountId}`}>割当クライアント</label>
                                <select
                                  id={`ca-client-${r.externalAccountId}`}
                                  className="select"
                                  value={r.clientId}
                                  onChange={(e) => updateRow(r.externalAccountId, { clientId: e.target.value })}
                                  disabled={completing}
                                >
                                  <option value="">クライアントを選択…</option>
                                  {clients.map((cl) => (
                                    <option key={cl.id} value={cl.id}>{cl.name}</option>
                                  ))}
                                </select>
                              </div>
                              <div className="field">
                                <label htmlFor={`ca-budget-${r.externalAccountId}`}>月予算 (任意・円)</label>
                                <input
                                  id={`ca-budget-${r.externalAccountId}`}
                                  className="input num"
                                  type="number"
                                  min={0}
                                  step={10000}
                                  placeholder="例: 300000"
                                  value={r.monthlyBudget}
                                  onChange={(e) => updateRow(r.externalAccountId, { monthlyBudget: e.target.value })}
                                  disabled={completing}
                                />
                              </div>
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  )}

                  {completing ? (
                    <div style={{ marginTop: 14 }}>
                      <p style={{ margin: '0 0 10px', fontWeight: 600, color: 'var(--primary)' }}>
                        接続して直近30日分を同期中… 約1分
                      </p>
                      <SkeletonLines count={3} />
                    </div>
                  ) : null}

                  <div className="row-actions" style={{ marginTop: 14 }}>
                    <button type="button" className="btn pri" onClick={complete} disabled={!canComplete}>
                      {completing ? '同期中…' : '接続して同期を開始'}
                    </button>
                    <button type="button" className="btn sec" onClick={resetWizard} disabled={completing}>
                      媒体選択に戻る
                    </button>
                    {checkedRows.length > 0 && !canComplete && !completing ? (
                      <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                        選択したアカウントすべてにクライアントを割り当ててください。
                      </span>
                    ) : null}
                  </div>
                </>
              ) : null}
            </>
          )}
        </div>
      </div>
    </>
  );
}
