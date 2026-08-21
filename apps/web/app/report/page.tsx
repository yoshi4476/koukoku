'use client';

import { useEffect, useState } from 'react';
import type { ReportRunDto } from '@adgrid/shared';
import { useApi } from '@/components/use-api';
import { useClients } from '@/components/client-context';
import { ErrorCard, MockBadge, SkeletonLines } from '@/components/ui';
import { apiPost, ApiError, toApiError } from '@/lib/api';
import { REPORT_SECTION_LABEL } from '@/lib/labels';
import { formatDate, formatDateTime } from '@/lib/format';

const SECTION_ORDER: Record<string, number> = { result: 0, cause: 1, action: 2 };

function ReportView({ report, clientName }: { report: ReportRunDto; clientName: string }) {
  const sections = [...report.result.sections].sort(
    (a, b) => (SECTION_ORDER[a.kind] ?? 9) - (SECTION_ORDER[b.kind] ?? 9),
  );
  return (
    <>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="c-head">
          <h2>エグゼクティブサマリ</h2>
          {report.mocked ? <MockBadge /> : null}
          <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--muted)' }} className="num">
            {clientName} · 週次 · 開始 {formatDate(report.periodStart)} · 生成 {formatDateTime(report.createdAt)}
          </span>
          <a
            className="btn sm sec"
            href={`/report/print?id=${encodeURIComponent(report.id)}`}
            target="_blank"
            rel="noopener"
          >
            印刷 / PDF保存
          </a>
        </div>
        <div className="c-body">
          <p style={{ margin: 0 }}>{report.result.executive_summary}</p>
        </div>
      </div>
      {sections.map((s, i) => (
        <div className="card" style={{ marginBottom: 12 }} key={`${s.kind}-${i}`}>
          <div className="c-head">
            <span className="pill ai">{REPORT_SECTION_LABEL[s.kind] ?? s.kind}</span>
            <h2>{s.heading}</h2>
          </div>
          <div className="c-body">
            <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{s.body}</p>
          </div>
        </div>
      ))}
    </>
  );
}

export default function ReportPage() {
  const { clients, loading: clientsLoading, error: clientsError, reload, selectedClientId } = useClients();
  const [clientId, setClientId] = useState('');
  const [report, setReport] = useState<ReportRunDto | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<ApiError | null>(null);

  useEffect(() => {
    if (selectedClientId) setClientId(selectedClientId);
  }, [selectedClientId]);

  const history = useApi<ReportRunDto[]>(clientId ? `/reports?clientId=${encodeURIComponent(clientId)}` : '/reports');

  const clientName = (id: string) => clients.find((c) => c.id === id)?.name ?? id;

  const runReport = () => {
    if (!clientId) return;
    setRunning(true);
    setRunError(null);
    setReport(null);
    apiPost<ReportRunDto>('/reports/run', { clientId, periodType: 'weekly' })
      .then((r) => {
        setReport(r);
        setRunning(false);
        history.retry();
      })
      .catch((e: unknown) => {
        setRunError(toApiError(e));
        setRunning(false);
      });
  };

  return (
    <>
      <div className="page-h">
        <h1>レポート</h1>
        <span className="sub">「結果 → 要因 → 次のアクション」の構成で自動生成します</span>
      </div>

      {clientsError ? <ErrorCard error={clientsError} onRetry={reload} /> : null}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="c-body row-actions">
          <div className="field">
            <label htmlFor="report-client">クライアント</label>
            <select id="report-client" className="select" value={clientId} onChange={(e) => setClientId(e.target.value)} disabled={clientsLoading}>
              <option value="">選択してください</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div style={{ alignSelf: 'flex-end' }}>
            <button type="button" className="btn pri" onClick={runReport} disabled={!clientId || running}>
              {running ? '生成中…' : '週次レポートを生成'}
            </button>
          </div>
        </div>
      </div>

      {runError ? <ErrorCard error={runError} onRetry={runReport} /> : null}

      {running ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="c-body">
            <p style={{ margin: '0 0 12px', fontWeight: 600, color: 'var(--primary)' }}>実績データを集計してレポートを生成中…</p>
            <SkeletonLines count={5} />
          </div>
        </div>
      ) : null}

      {report ? <ReportView report={report} clientName={clientName(report.clientId)} /> : null}

      {!report && !running && !runError ? (
        <div className="empty" style={{ marginBottom: 16 }}>
          <div className="e-title">まだレポートを表示していません</div>
          <div className="e-sub">クライアントを選んで生成すると、結果・要因・次のアクションを1画面で確認できます。</div>
        </div>
      ) : null}

      <div className="card section-gap">
        <div className="c-head"><h2>レポート履歴</h2></div>
        {history.loading ? (
          <div className="c-body"><SkeletonLines count={3} /></div>
        ) : history.error ? (
          <div className="c-body"><ErrorCard error={history.error} onRetry={history.retry} /></div>
        ) : (history.data ?? []).length === 0 ? (
          <div className="c-body" style={{ color: 'var(--muted)', fontSize: 12.5 }}>まだレポート履歴がありません。</div>
        ) : (
          <div>
            {(history.data ?? []).map((h) => (
              <button type="button" key={h.id} className="history-item" onClick={() => setReport(h)}>
                <span className="h-date num">{formatDateTime(h.createdAt)}</span>
                <span className="tag">{clientName(h.clientId)}</span>
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
