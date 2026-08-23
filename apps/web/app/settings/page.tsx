'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { BillingDto, CalibrationDto, ConnectionDto, Edition, IntegrationStatusDto, MeDto, MemberDto, UsageDto } from '@adgrid/shared';
import { PLANS, isApprover, editionAllows, EDITION_LABEL } from '@adgrid/shared';
import { useApi } from '@/components/use-api';
import { useAuth } from '@/components/auth-context';
import { ErrorCard, HintBar, Skeleton, SkeletonLines } from '@/components/ui';
import { apiPost, apiPut, ApiError, toApiError } from '@/lib/api';
import { CALIBRATION_EFFECT_META, MEMBER_ROLE_LABEL, USAGE_FEATURE_LABEL } from '@/lib/labels';
import { formatNumber, formatPercent, formatYen } from '@/lib/format';

interface RunWeeklyAllResult {
  generated: number;
  skipped: number;
  failed: number;
}

/* ---- カード4: 自動レポート ---- */
function AutoReportCard() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunWeeklyAllResult | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const run = () => {
    if (running) return;
    setRunning(true);
    setError(null);
    setResult(null);
    apiPost<RunWeeklyAllResult>('/reports/run-weekly-all', {})
      .then((r) => {
        setResult(r);
        setRunning(false);
      })
      .catch((e: unknown) => {
        setError(toApiError(e));
        setRunning(false);
      });
  };

  return (
    <div className="card" style={{ marginBottom: 16, maxWidth: 640 }}>
      <div className="c-head"><h2>自動レポート</h2></div>
      <div className="c-body form-grid">
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-2)' }}>
          毎週月曜 7:00 に全クライアントの週次レポートを自動生成します。
        </p>
        {error ? <ErrorCard error={error} onRetry={run} /> : null}
        {result ? (
          <div className="alert info" style={{ marginBottom: 0 }}>
            <span className="a-ico" aria-hidden="true">●</span>
            <div>
              <span className="a-title num">生成 {result.generated}件 / スキップ {result.skipped}件</span>
              {result.failed > 0 ? (
                <>
                  <br />
                  <span className="a-body num">失敗 {result.failed}件がありました。時間をおいて再実行してください。</span>
                </>
              ) : null}
              <br />
              <Link href="/report" style={{ fontSize: 12.5 }}>レポート画面で確認する</Link>
            </div>
          </div>
        ) : null}
        <div>
          <button type="button" className="btn pri" onClick={run} disabled={running}>
            {running ? '生成中…' : '今すぐ実行 (今週分)'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---- カード5: 自動適用 (kill switch / F-16) ---- */
function ApplySettingsCard() {
  const { me } = useAuth();
  const canEdit = isApprover(me.role);
  const settings = useApi<{ applyEnabled: boolean }>('/proposals/settings');
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    if (settings.data) setEnabled(settings.data.applyEnabled);
  }, [settings.data]);

  const toggle = (next: boolean) => {
    if (saving) return;
    setSaving(true);
    setError(null);
    apiPut<{ applyEnabled: boolean }>('/proposals/settings', { applyEnabled: next })
      .then((r) => {
        setEnabled(r.applyEnabled);
        setSaving(false);
      })
      .catch((e: unknown) => {
        setError(toApiError(e));
        setSaving(false);
        // サーバ状態と食い違わないよう再取得して同期する
        settings.retry();
      });
  };

  return (
    <div className="card" style={{ marginBottom: 16, maxWidth: 640 }}>
      <div className="c-head"><h2>自動適用 (kill switch)</h2></div>
      {settings.loading ? (
        <div className="c-body"><SkeletonLines count={2} /></div>
      ) : settings.error ? (
        <div className="c-body"><ErrorCard error={settings.error} onRetry={settings.retry} /></div>
      ) : enabled !== null ? (
        <div className="c-body form-grid">
          {error ? <ErrorCard error={error} /> : null}
          <div className="row-actions">
            <label className="switch" title={enabled ? '停止する' : '再開する'}>
              <input
                type="checkbox"
                checked={enabled}
                disabled={saving || !canEdit}
                aria-label="提案の承認・実行を有効にする"
                onChange={(e) => toggle(e.target.checked)}
              />
              <span className="sw-track" aria-hidden="true" />
              <span className="sw-knob" aria-hidden="true" />
            </label>
            <span style={{ fontSize: 13, fontWeight: 600, color: enabled ? 'var(--good)' : 'var(--bad)' }}>
              {enabled ? '稼働中' : '停止中'}
            </span>
            {saving ? <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>保存中…</span> : null}
          </div>
          <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-2)' }}>
            停止中は承認・実行がすべてブロックされます (緊急停止用)。
          </p>
          {!canEdit ? (
            <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)' }}>
              変更はオーナー/管理者のみ行えます。
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/* ---- カード7: 確信度較正 (A-4) ---- */
function CalibrationCard() {
  const calibration = useApi<CalibrationDto[]>('/knowledge/calibration');
  const rows = calibration.data ?? [];

  return (
    <div className="card" style={{ marginBottom: 16, maxWidth: 640 }}>
      <div className="c-head"><h2>AIの確信度較正 (学習状況)</h2></div>
      {calibration.loading ? (
        <div className="c-body"><SkeletonLines count={3} /></div>
      ) : calibration.error ? (
        <div className="c-body"><ErrorCard error={calibration.error} onRetry={calibration.retry} /></div>
      ) : (
        <>
          <div className="c-body tbl-scroll" style={{ padding: 0 }}>
            {rows.length === 0 ? (
              <p style={{ padding: '14px 16px', margin: 0, color: 'var(--muted)', fontSize: 12.5 }}>
                較正データはまだありません。診断の採用・見送りが蓄積されると表示されます。
              </p>
            ) : (
              <table className="data-tbl">
                <thead>
                  <tr>
                    <th>カテゴリ</th>
                    <th>採用</th>
                    <th>見送り</th>
                    <th>採用率</th>
                    <th style={{ textAlign: 'left' }}>効果</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const effect = CALIBRATION_EFFECT_META[r.effect];
                    return (
                      <tr key={r.category}>
                        <td>{r.categoryLabel}</td>
                        <td>{formatNumber(r.adopted)}</td>
                        <td>{formatNumber(r.dismissed)}</td>
                        <td>{r.adoptionRate === null ? '—' : formatPercent(r.adoptionRate * 100, 0)}</td>
                        <td style={{ textAlign: 'left' }}>
                          <span className={`pill ${effect.cls}`}>{effect.label}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          <div className="c-body" style={{ paddingTop: 10, borderTop: '1px solid var(--line)' }}>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)' }}>
              診断の採用・見送りの実績から、成果につながりやすい指摘カテゴリの確信度を自動で補正します。使うほど診断の精度が上がります。
            </p>
          </div>
        </>
      )}
    </div>
  );
}

/* ---- カード0: 版 (edition) 切替 ---- */
const EDITIONS: { id: Edition; desc: string }[] = [
  { id: 'agency', desc: '全機能。複数クライアントの運用・承認・自動適用・媒体接続・課金までを社内で扱う運用者向け。' },
  { id: 'client', desc: '提供先(クライアント企業)に下ろす版。自社の実績・診断・レポート閲覧が中心で、承認・自動適用や媒体接続・課金などの運用/管理画面は非表示。' },
];

function EditionCard() {
  const { me, setMe } = useAuth();
  const [saving, setSaving] = useState<Edition | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const canEdit = me.role === 'owner';

  const switchTo = (edition: Edition) => {
    if (edition === me.edition || saving) return;
    setSaving(edition);
    setError(null);
    apiPut<MeDto>('/auth/edition', { edition })
      .then((updated) => setMe(updated))
      .catch((e: unknown) => setError(toApiError(e)))
      .finally(() => setSaving(null));
  };

  return (
    <div className="card" style={{ marginBottom: 16, maxWidth: 640 }}>
      <div className="c-head">
        <h2>提供版 (エディション)</h2>
        <span className={`pill ${me.edition === 'agency' ? 'ai' : 'flat'}`} style={{ marginLeft: 'auto' }}>
          現在: {EDITION_LABEL[me.edition]}
        </span>
      </div>
      <div className="c-body form-grid">
        <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-2)' }}>
          1つのシステムで<mark>自社運用版</mark>と<mark>提供先版</mark>を切り替えられます。提供先版に切り替えると、運用/管理系のメニューと操作が自動的に隠れます。
        </p>
        {error ? <ErrorCard error={error} /> : null}
        <div className="edition-choices">
          {EDITIONS.map((e) => {
            const active = me.edition === e.id;
            return (
              <button
                key={e.id}
                type="button"
                className={`edition-choice${active ? ' on' : ''}`}
                disabled={!canEdit || saving !== null}
                aria-pressed={active}
                onClick={() => switchTo(e.id)}
              >
                <span className="ec-head">
                  <span className="ec-name">{EDITION_LABEL[e.id]}</span>
                  {active ? <span className="pill ai">選択中</span> : saving === e.id ? <span className="pill flat">切替中…</span> : null}
                </span>
                <span className="ec-desc">{e.desc}</span>
              </button>
            );
          })}
        </div>
        {!canEdit ? (
          <p style={{ margin: 0, fontSize: 11.5, color: 'var(--muted)' }}>版の切替はオーナーのみ可能です。</p>
        ) : null}
      </div>
    </div>
  );
}

/* 外部連携の有効化状況・接続テスト (F-48) */
function IntegrationsCard() {
  const { me } = useAuth();
  const canManage = isApprover(me.role);
  const status = useApi<IntegrationStatusDto>(canManage ? '/integrations/status' : null);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<{ ok: boolean; message: string } | null>(null);
  if (!canManage) return null;

  const runTest = () => {
    setTesting(true); setTestMsg(null);
    apiPost<{ ok: boolean; message: string }>('/integrations/test/anthropic', {})
      .then((r) => setTestMsg(r)).catch((e: unknown) => setTestMsg({ ok: false, message: toApiError(e).message })).finally(() => setTesting(false));
  };

  return (
    <div className="card" style={{ marginBottom: 16, maxWidth: 780 }}>
      <div className="c-head"><h2>🔌 外部連携（有効化状況）</h2>
        {status.data ? <span className="sub" style={{ marginLeft: 'auto' }}>有効 <b className="num">{status.data.readyCount}</b>/<b className="num">{status.data.total}</b></span> : null}
      </div>
      <div className="c-body">
        <p style={{ margin: '0 0 12px', fontSize: 12.5, color: 'var(--ink-2)', lineHeight: 1.6 }}>
          各サービスの鍵を <code style={{ fontFamily: 'ui-monospace,monospace' }}>apps/api/.env</code> に設定してAPIを再起動すると、下の状態が「設定済」に変わり機能が有効になります。<b>秘密の値は保存・表示しません</b>（設定済か否かのみ判定）。
        </p>
        {status.loading ? <SkeletonLines count={4} /> : status.error ? <ErrorCard error={status.error} onRetry={status.retry} /> : status.data ? (
          <div className="intg-list">
            {status.data.items.map((it) => (
              <div key={it.key} className={`intg-row ${it.configured ? 'on' : ''}`}>
                <span className="intg-mark">{it.configured ? '✓' : '—'}</span>
                <div className="intg-main">
                  <div className="intg-h"><b>{it.label}</b><span className="intg-cat">{it.category}</span>
                    <span className={`pill ${it.configured ? 'up' : 'flat'}`} style={{ marginLeft: 'auto' }}>{it.configured ? '設定済' : '未設定'}</span></div>
                  <div className="intg-env">{it.envVars.join(' / ')}</div>
                  <div className="intg-note">{it.configured ? `✅ ${it.activates}` : `未設定時: ${it.fallback}`}</div>
                </div>
              </div>
            ))}
          </div>
        ) : null}
        <div className="intg-test">
          <button className="btn sm sec" disabled={testing} onClick={runTest}>{testing ? 'テスト中…' : '実Claude 接続テスト'}</button>
          {testMsg ? <span className={testMsg.ok ? 'intg-ok' : 'intg-ng'}>{testMsg.ok ? '✓ ' : '✗ '}{testMsg.message}</span> : null}
          <span className="intg-test-note">※ 最小1回だけ実呼び出し（約¥0.1）。鍵設定後の疎通確認に。</span>
        </div>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { me } = useAuth();
  const usage = useApi<UsageDto>('/usage');
  const members = useApi<MemberDto[]>('/usage/members');
  const billing = useApi<BillingDto>('/billing');
  const connections = useApi<ConnectionDto[]>('/connections');

  const planPrice = billing.data ? PLANS[billing.data.plan.id].monthlyPriceJpy : null;
  const connectedCount = (connections.data ?? []).filter((c) => c.status === 'connected').length;
  const syncedAccounts = (connections.data ?? []).reduce((sum, c) => sum + c.accountCount, 0);

  return (
    <>
      <div className="page-h">
        <h1>設定</h1>
        <span className="sub">ワークスペース・AI利用量・メンバーの管理</span>
      </div>

      <HintBar id="settings" title="設定画面でできること">
        <mark>提供版の切替</mark>、プラン・<mark>AI利用量</mark>・メンバーの確認、<mark>自動レポートの手動実行</mark>、承認フローのkill switch、AIの確信度較正の学習状況、API接続の管理ができます。
      </HintBar>

      {/* カード0: 版切替 */}
      <EditionCard />

      {/* 外部連携の有効化状況 */}
      <IntegrationsCard />

      {/* カード1: ワークスペース */}
      <div className="card" style={{ marginBottom: 16, maxWidth: 640 }}>
        <div className="c-head"><h2>ワークスペース</h2></div>
        <div className="c-body" style={{ padding: 0 }}>
          <table className="data-tbl">
            <tbody>
              <tr>
                <td style={{ color: 'var(--muted)', fontSize: 12 }}>テナント名</td>
                <td style={{ textAlign: 'left' }}>{me.tenantName}</td>
              </tr>
              <tr>
                <td style={{ color: 'var(--muted)', fontSize: 12 }}>プラン</td>
                <td style={{ textAlign: 'left' }}>
                  {billing.loading ? (
                    <Skeleton w={140} h={12} />
                  ) : billing.data ? (
                    <>
                      {billing.data.plan.label}
                      {!billing.data.billingConfigured ? (
                        <span style={{ marginLeft: 8, fontSize: 11.5, color: 'var(--muted)' }}>
                          トライアル中 (決済は未設定)
                        </span>
                      ) : null}
                    </>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
              <tr>
                <td style={{ color: 'var(--muted)', fontSize: 12 }}>月額</td>
                <td style={{ textAlign: 'left' }} className="num">
                  {billing.loading ? (
                    <Skeleton w={90} h={12} />
                  ) : billing.data ? (
                    planPrice === null ? '個別見積' : `${formatYen(planPrice)} / 月`
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
              <tr>
                <td style={{ color: 'var(--muted)', fontSize: 12 }}>アカウント使用数</td>
                <td style={{ textAlign: 'left' }} className="num">
                  {billing.loading ? (
                    <Skeleton w={70} h={12} />
                  ) : billing.data ? (
                    `${formatNumber(billing.data.accountsUsed)} / ${billing.data.accountLimit === null ? '無制限' : formatNumber(billing.data.accountLimit)}`
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
              <tr>
                <td style={{ color: 'var(--muted)', fontSize: 12 }}>あなたのロール</td>
                <td style={{ textAlign: 'left' }}>{MEMBER_ROLE_LABEL[me.role]}</td>
              </tr>
            </tbody>
          </table>
        </div>
        {billing.error ? (
          <div className="c-body" style={{ borderTop: '1px solid var(--line)' }}>
            <ErrorCard error={billing.error} onRetry={billing.retry} />
          </div>
        ) : null}
      </div>

      {/* カード2: AI利用量 (今月) */}
      <div className="card" style={{ marginBottom: 16, maxWidth: 640 }}>
        <div className="c-head"><h2>AI利用量 (今月)</h2></div>
        {usage.loading ? (
          <div className="c-body"><SkeletonLines count={4} /></div>
        ) : usage.error ? (
          <div className="c-body"><ErrorCard error={usage.error} onRetry={usage.retry} /></div>
        ) : usage.data ? (
          <div className="c-body form-grid">
            <div className="result-stat">
              <div className="rs">
                <div className="rs-label">合計コスト</div>
                <div className="rs-val">{formatYen(usage.data.monthCostJpy)}</div>
              </div>
              <div className="rs">
                <div className="rs-label">実行回数</div>
                <div className="rs-val">
                  {formatNumber(usage.data.monthCallCount)}
                  <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500 }}> 回</span>
                </div>
              </div>
            </div>
            {usage.data.byFeature.length > 0 ? (
              <div className="tbl-scroll">
                <table className="data-tbl">
                  <thead>
                    <tr>
                      <th>機能</th>
                      <th>実行回数</th>
                      <th>原価</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usage.data.byFeature.map((f) => (
                      <tr key={f.feature}>
                        <td>{USAGE_FEATURE_LABEL[f.feature] ?? f.feature}</td>
                        <td>{formatNumber(f.count)}</td>
                        <td>{formatYen(f.costJpy)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p style={{ margin: 0, color: 'var(--muted)', fontSize: 12.5 }}>今月のAI実行はまだありません。</p>
            )}
            {usage.data.mockedNote ? (
              <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)' }}>
                現在モックモードのためAPI原価は発生していません。
              </p>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* カード3: メンバー (提供先版では非表示) */}
      {editionAllows(me.edition, 'members') ? (
      <div className="card" style={{ marginBottom: 16, maxWidth: 640 }}>
        <div className="c-head"><h2>メンバー</h2></div>
        {members.loading ? (
          <div className="c-body"><SkeletonLines count={3} /></div>
        ) : members.error ? (
          <div className="c-body"><ErrorCard error={members.error} onRetry={members.retry} /></div>
        ) : (
          <>
            <div className="c-body tbl-scroll" style={{ padding: 0 }}>
              {(members.data ?? []).length === 0 ? (
                <p style={{ padding: '14px 16px', margin: 0, color: 'var(--muted)', fontSize: 12.5 }}>メンバーが見つかりません。</p>
              ) : (
                <table className="data-tbl">
                  <thead>
                    <tr>
                      <th>名前</th>
                      <th style={{ textAlign: 'left' }}>メール</th>
                      <th style={{ textAlign: 'left' }}>ロール</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(members.data ?? []).map((m) => (
                      <tr key={m.userId}>
                        <td>{m.name}</td>
                        <td style={{ textAlign: 'left' }}>{m.email}</td>
                        <td style={{ textAlign: 'left' }}>{MEMBER_ROLE_LABEL[m.role]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="c-body" style={{ paddingTop: 10, borderTop: '1px solid var(--line)' }}>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)' }}>
                メンバー招待はEnterpriseプランで提供予定です。
              </p>
            </div>
          </>
        )}
      </div>
      ) : null}

      {/* カード4: 自動レポート */}
      <AutoReportCard />

      {/* カード5: 自動適用 (kill switch) — 提供先版では非表示 */}
      {editionAllows(me.edition, 'autoApply') ? <ApplySettingsCard /> : null}

      {/* カード7: 確信度較正 (A-4) */}
      <CalibrationCard />

      {/* カード6: API接続 — 提供先版では非表示 */}
      {editionAllows(me.edition, 'connections') ? (
      <div className="card" style={{ marginBottom: 16, maxWidth: 640 }}>
        <div className="c-head"><h2>API接続</h2></div>
        {connections.loading ? (
          <div className="c-body"><SkeletonLines count={2} /></div>
        ) : connections.error ? (
          <div className="c-body"><ErrorCard error={connections.error} onRetry={connections.retry} /></div>
        ) : (
          <div className="c-body form-grid">
            <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-2)' }} className="num">
              {connectedCount === 0
                ? '接続中の媒体はありません。媒体APIを接続すると実績データを自動同期できます。'
                : `接続中 ${connectedCount}媒体 · アカウント ${syncedAccounts}件を自動同期しています。`}
            </p>
            <div>
              <Link href="/connections" className="btn pri">API接続を管理</Link>
            </div>
          </div>
        )}
      </div>
      ) : null}
    </>
  );
}
