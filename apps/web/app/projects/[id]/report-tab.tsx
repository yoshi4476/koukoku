'use client';

import { useState } from 'react';
import type { ReportDeliveryDto, ReportRunDto, ShareLinkDto } from '@adgrid/shared';
import { useApi } from '@/components/use-api';
import { ErrorCard, MockBadge, SkeletonLines } from '@/components/ui';
import { apiDelete, apiPost, toApiError, type ApiError } from '@/lib/api';
import { REPORT_SECTION_LABEL } from '@/lib/labels';
import { formatDate, formatDateTime } from '@/lib/format';

const SECTION_ORDER: Record<string, number> = { result: 0, cause: 1, action: 2 };
const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:4000';

/** レポートをクライアントへ配信する。Slack未設定時は共有リンクを発行 */
function DeliverBox({ reportId }: { reportId: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ReportDeliveryDto | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [copied, setCopied] = useState(false);

  const deliver = () => {
    setBusy(true); setError(null);
    apiPost<ReportDeliveryDto>(`/reports/${encodeURIComponent(reportId)}/deliver`, {})
      .then(setResult)
      .catch((e: unknown) => setError(toApiError(e)))
      .finally(() => setBusy(false));
  };
  const copy = () => {
    if (!result) return;
    navigator.clipboard?.writeText(result.url)
      .then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); })
      .catch(() => undefined);
  };

  return (
    <div className="deliver">
      <div className="deliver-row">
        <button type="button" className="btn sm pri" onClick={deliver} disabled={busy}>
          {busy ? '配信中…' : result ? '再配信' : 'クライアントに配信'}
        </button>
        {result
          ? <span className={`pill ${result.channel === 'slack' ? 'up' : 'flat'}`}>{result.channel === 'slack' ? 'Slackに配信済' : '共有リンク発行済'}</span>
          : <span className="deliver-hint">Slack未設定でも共有リンクを発行して配信できます</span>}
      </div>
      {error ? <ErrorCard error={error} onRetry={deliver} /> : null}
      {result ? (
        <div className="deliver-result">
          <p className="deliver-msg">{result.message}</p>
          <div className="deliver-link">
            <input readOnly className="input" value={result.url} onFocus={(e) => e.currentTarget.select()} />
            <button type="button" className="btn sm sec" onClick={copy}>{copied ? 'コピー済' : 'コピー'}</button>
            {/^https?:\/\//i.test(result.url)
              ? <a className="btn sm sec" href={result.url} target="_blank" rel="noopener noreferrer">開く ↗</a> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** 常時公開のライブポータル (レポートとは別に、いつでも見られる共有ダッシュボード) */
function SharePortal({ clientId }: { clientId: string }) {
  const share = useApi<ShareLinkDto>(`/clients/${clientId}/share`);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const link = share.data;

  const toggle = () => {
    setBusy(true);
    const p = link?.enabled ? apiDelete(`/clients/${clientId}/share`) : apiPost(`/clients/${clientId}/share`, {});
    p.then(() => share.retry()).finally(() => setBusy(false));
  };
  const url = link?.token ? `${window.location.origin}/share/${link.token}` : '';

  return (
    <div className="card section-gap">
      <div className="c-head"><h2>🔗 ライブポータル（常時公開）</h2></div>
      <div className="c-body">
        <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.75 }}>
          レポートとは別に、<mark>ログイン不要でいつでも実績を見られるページ</mark>を発行できます。クライアントへの都度報告の手間が減ります。
        </p>
        {share.loading ? <SkeletonLines count={2} /> : (
          <>
            <div className="deliver-row">
              <button type="button" className="btn sm pri" onClick={toggle} disabled={busy}>
                {busy ? '処理中…' : link?.enabled ? '共有を停止' : '共有リンクを発行'}
              </button>
              <span className={`pill ${link?.enabled ? 'up' : 'flat'}`}>{link?.enabled ? '公開中' : '停止中'}</span>
            </div>
            {link?.enabled && url ? (
              <div className="deliver-link" style={{ marginTop: 10 }}>
                <input readOnly className="input" value={url} onFocus={(e) => e.currentTarget.select()} />
                <button type="button" className="btn sm sec"
                  onClick={() => { navigator.clipboard?.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1600); }).catch(() => undefined); }}>
                  {copied ? 'コピー済' : 'コピー'}
                </button>
                <a className="btn sm sec" href={url} target="_blank" rel="noopener noreferrer">開く ↗</a>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * 報告タブ (F-53)。プロジェクトを離れずに「レポート生成 → 配信 → 共有」まで完結させる。
 * レポートはクライアント単位で作成される (このプロジェクトのクライアントが対象)。
 */
export function ReportTab({ clientId, clientName }: { clientId: string; clientName: string }) {
  const history = useApi<ReportRunDto[]>(`/reports?clientId=${encodeURIComponent(clientId)}`);
  const [report, setReport] = useState<ReportRunDto | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const run = (periodType: 'weekly' | 'monthly') => {
    setRunning(true); setError(null); setReport(null);
    apiPost<ReportRunDto>('/reports/run', { clientId, periodType })
      .then((r) => { setReport(r); history.retry(); })
      .catch((e: unknown) => setError(toApiError(e)))
      .finally(() => setRunning(false));
  };

  const sections = report ? [...report.result.sections].sort((a, b) => (SECTION_ORDER[a.kind] ?? 9) - (SECTION_ORDER[b.kind] ?? 9)) : [];

  return (
    <>
      <div className="card">
        <div className="c-head"><h2>レポートを作る</h2></div>
        <div className="c-body">
          <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.75 }}>
            <b>{clientName}</b> の実績から「<mark>結果 → 要因 → 次のアクション</mark>」構成のレポートを自動生成します。
            PDF・スライドで書き出して、そのまま報告に使えます。
          </p>
          <div className="deliver-row">
            <button type="button" className="btn pri" onClick={() => run('weekly')} disabled={running}>
              {running ? '生成中…' : '週次レポートを生成'}
            </button>
            <button type="button" className="btn sec" onClick={() => run('monthly')} disabled={running}>月次で生成</button>
          </div>
          {error ? <ErrorCard error={error} onRetry={() => run('weekly')} /> : null}
          {running ? <div style={{ marginTop: 14 }}><SkeletonLines count={4} /></div> : null}
        </div>
      </div>

      {report ? (
        <>
          <div className="card section-gap">
            <div className="c-head">
              <h2>エグゼクティブサマリ</h2>
              {report.mocked ? <MockBadge /> : null}
              <span className="num" style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--muted)' }}>
                開始 {formatDate(report.periodStart)} · 生成 {formatDateTime(report.createdAt)}
              </span>
              <a className="btn sm sec" href={`${API_BASE}/reports/${encodeURIComponent(report.id)}/pdf`}>PDF</a>
              <a className="btn sm sec" href={`${API_BASE}/reports/${encodeURIComponent(report.id)}/pptx`}>スライド</a>
            </div>
            <div className="c-body">
              <p style={{ margin: '0 0 12px' }}>{report.result.executive_summary}</p>
              <DeliverBox reportId={report.id} />
            </div>
          </div>
          {sections.map((s, i) => (
            <div className="card section-gap" key={`${s.kind}-${i}`}>
              <div className="c-head">
                <span className="pill ai">{REPORT_SECTION_LABEL[s.kind] ?? s.kind}</span>
                <h2>{s.heading}</h2>
              </div>
              <div className="c-body"><p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{s.body}</p></div>
            </div>
          ))}
        </>
      ) : null}

      <SharePortal clientId={clientId} />

      <div className="card section-gap">
        <div className="c-head"><h2>レポート履歴</h2></div>
        {history.loading ? <div className="c-body"><SkeletonLines count={3} /></div>
          : history.error ? <div className="c-body"><ErrorCard error={history.error} onRetry={history.retry} /></div>
          : (history.data ?? []).length === 0
            ? <div className="c-body" style={{ color: 'var(--muted)', fontSize: 12.5 }}>まだレポートがありません。</div>
            : (
              <div>
                {(history.data ?? []).map((h) => (
                  <button type="button" key={h.id} className="history-item" onClick={() => setReport(h)}>
                    <span className="h-date num">{formatDateTime(h.createdAt)}</span>
                    <span className="pill flat">{h.periodType === 'weekly' ? '週次' : '月次'}</span>
                    <span style={{ flex: 1, minWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {h.result.executive_summary}
                    </span>
                    {h.mocked ? <MockBadge /> : null}
                  </button>
                ))}
              </div>
            )}
      </div>
    </>
  );
}
