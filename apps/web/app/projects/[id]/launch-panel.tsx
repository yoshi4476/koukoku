'use client';

import { useState } from 'react';
import type { LaunchPlanDto, LaunchResultDto } from '@adgrid/shared';
import { useApi } from '@/components/use-api';
import { ErrorCard, SkeletonLines } from '@/components/ui';
import { apiPost, toApiError, type ApiError } from '@/lib/api';
import { formatYen } from '@/lib/format';

/**
 * Google広告への実入稿 (F-56)。
 * 「② 配信設定」と「③ 制作物」の内容をキャンペーン/広告グループ/キーワード/広告に変換して入稿する。
 * 事故防止のため必ず一時停止で作成し、配信開始は別ボタンにしている。
 */
export function LaunchPanel({ projectId }: { projectId: string }) {
  const plan = useApi<LaunchPlanDto>(`/projects/${projectId}/launch-plan`);
  const [accountId, setAccountId] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<LaunchResultDto | null>(null);
  const [enabled, setEnabled] = useState<string>('');
  const [error, setError] = useState<ApiError | null>(null);
  const [confirm, setConfirm] = useState(false);

  const p = plan.data;
  const target = p?.accounts.find((a) => a.adAccountId === (accountId || p?.accounts[0]?.adAccountId));

  const launch = () => {
    setBusy(true); setError(null);
    apiPost<LaunchResultDto>(`/projects/${projectId}/launch`, { adAccountId: target?.adAccountId })
      .then((r) => { setResult(r); setConfirm(false); })
      .catch((e: unknown) => setError(toApiError(e)))
      .finally(() => setBusy(false));
  };

  const enable = () => {
    if (!result || !target) return;
    setBusy(true); setError(null);
    apiPost<{ message: string }>(`/projects/${projectId}/launch/enable`, {
      externalAccountId: target.externalAccountId, campaignId: result.campaignId,
    })
      .then((r) => setEnabled(r.message))
      .catch((e: unknown) => setError(toApiError(e)))
      .finally(() => setBusy(false));
  };

  if (plan.loading) return <div className="card"><div className="c-body"><SkeletonLines count={4} /></div></div>;
  if (plan.error) return <ErrorCard error={plan.error} onRetry={plan.retry} />;
  if (!p) return null;

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="c-head">
        <h2>🚀 Google広告へ入稿</h2>
        <span className={`pill ${p.ready ? 'up' : 'warn'}`} style={{ marginLeft: 'auto' }}>
          {p.ready ? '入稿できます' : `不足 ${p.issues.length}件`}
        </span>
      </div>
      <div className="c-body">
        <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.75 }}>
          「② 配信設定」と「③ 制作物」の内容から、<mark>検索キャンペーンを作成</mark>します。
          <b>必ず一時停止の状態で作成される</b>ため、内容を確認してから配信を開始できます。
        </p>

        {p.issues.length > 0 ? (
          <div className="launch-issues">
            <div className="li-h">入稿前に解消が必要です</div>
            {p.issues.map((it, i) => <div className="li-item" key={i}>・{it}</div>)}
          </div>
        ) : null}

        <div className="launch-grid">
          <div><span>キャンペーン名</span><b>{p.campaignName}</b></div>
          <div><span>日予算</span><b>{formatYen(p.dailyBudget)}<small>（月{formatYen(p.monthlyBudget)}相当）</small></b></div>
          <div><span>入札</span><b>{p.targetCpa ? `目標CPA ${formatYen(p.targetCpa)}` : 'コンバージョン数の最大化'}</b></div>
          <div><span>リンク先</span><b className="launch-url">{p.finalUrl || '—'}</b></div>
          <div><span>見出し</span><b>{p.headlines.length}本</b></div>
          <div><span>説明文</span><b>{p.descriptions.length}本</b></div>
          <div><span>キーワード</span><b>{p.keywords.length}語</b></div>
          <div><span>期間</span><b>{p.startDate ?? '即時'} 〜 {p.endDate ?? '無期限'}</b></div>
        </div>

        {p.headlines.length > 0 ? (
          <details className="launch-detail">
            <summary>入稿される広告文を確認する</summary>
            <div className="launch-copy">
              <div className="lc-h">見出し</div>
              {p.headlines.map((h, i) => <div className="lc-row" key={`h-${i}`}><span className="lc-n">{i + 1}</span>{h}<span className="lc-len">{h.length}字</span></div>)}
              <div className="lc-h">説明文</div>
              {p.descriptions.map((d, i) => <div className="lc-row" key={`d-${i}`}><span className="lc-n">{i + 1}</span>{d}<span className="lc-len">{d.length}字</span></div>)}
              {p.keywords.length > 0 ? (
                <>
                  <div className="lc-h">キーワード（フレーズ一致）</div>
                  <div className="lc-kws">{p.keywords.map((k, i) => <span className="tag" key={`k-${i}`}>{k}</span>)}</div>
                </>
              ) : null}
            </div>
          </details>
        ) : null}

        {p.accounts.length > 1 ? (
          <div className="field" style={{ marginTop: 12 }}>
            <label>入稿先アカウント</label>
            {/* 入稿後は変更不可。ここで別アカウントに切り替えると、B配下のcampaignIdを
                Aに対して配信開始する不整合が起きるため result 確定後はロックする */}
            <select className="select" value={accountId} disabled={busy || !!result} onChange={(e) => setAccountId(e.target.value)}>
              {p.accounts.map((a) => <option key={a.adAccountId} value={a.adAccountId}>{a.name}</option>)}
            </select>
          </div>
        ) : null}

        {error ? <ErrorCard error={error} /> : null}

        {!result ? (
          <div className="deliver-row" style={{ marginTop: 14 }}>
            {!confirm ? (
              <button type="button" className="btn pri" disabled={!p.ready || busy} onClick={() => setConfirm(true)}>
                入稿する（一時停止で作成）
              </button>
            ) : (
              <>
                <span style={{ fontSize: 13, color: 'var(--warn)', fontWeight: 700 }}>
                  {target?.name} に作成します。よろしいですか？
                </span>
                <button type="button" className="btn pri" disabled={busy} onClick={launch}>{busy ? '入稿中…' : '実行する'}</button>
                <button type="button" className="btn sec" disabled={busy} onClick={() => setConfirm(false)}>やめる</button>
              </>
            )}
          </div>
        ) : (
          <div className="launch-done">
            <div className="ld-h">✓ 入稿しました（一時停止）</div>
            <p className="ld-msg">{result.message}</p>
            <div className="ld-ids num">キャンペーンID: {result.campaignId} / 広告グループID: {result.adGroupId} / キーワード{result.keywordCount}語</div>
            {enabled ? (
              <div className="ld-enabled">🚀 {enabled}</div>
            ) : (
              <div className="deliver-row" style={{ marginTop: 10 }}>
                <button type="button" className="btn pri" disabled={busy} onClick={enable}>{busy ? '開始中…' : '配信を開始する（課金が始まります）'}</button>
                <span className="deliver-hint">Google広告の管理画面で内容を確認してから開始することを推奨します</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
