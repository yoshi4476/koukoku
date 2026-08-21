'use client';

import { useEffect, useState } from 'react';
import type { ClientDto, ReportRunDto } from '@adgrid/shared';
import { useApi } from '@/components/use-api';
import { ErrorCard, SkeletonLines } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { REPORT_SECTION_LABEL } from '@/lib/labels';
import { formatDate, formatDateTime } from '@/lib/format';

const SECTION_ORDER: Record<string, number> = { result: 0, cause: 1, action: 2 };

function periodLabel(report: ReportRunDto): string {
  const start = new Date(report.periodStart);
  if (Number.isNaN(start.getTime())) return report.periodStart;
  if (report.periodType === 'weekly') {
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return `${formatDate(start)}〜${formatDate(end)}`;
  }
  return `${start.getFullYear()}年${start.getMonth() + 1}月`;
}

export default function ReportPrintPage() {
  const [ready, setReady] = useState(false);
  const [reportId, setReportId] = useState<string | null>(null);

  useEffect(() => {
    setReportId(new URLSearchParams(window.location.search).get('id'));
    setReady(true);
  }, []);

  const reports = useApi<ReportRunDto[]>(ready && reportId ? '/reports' : null);
  const clients = useApi<ClientDto[]>(ready && reportId ? '/clients' : null);

  const report = (reports.data ?? []).find((r) => r.id === reportId) ?? null;
  const clientName = report
    ? (clients.data ?? []).find((c) => c.id === report.clientId)?.name ?? report.clientId
    : '';

  const loading = !ready || reports.loading || clients.loading;

  return (
    <div className="print-page">
      <div className="print-toolbar no-print">
        <span className="print-hint">PDFとして保存するには、印刷ダイアログで「PDFに保存」を選んでください。</span>
        <button type="button" className="btn pri print-btn" onClick={() => window.print()}>
          印刷する
        </button>
      </div>

      <div className="print-inner">
        {ready && !reportId ? (
          <div className="no-print">
            <ErrorCard
              error={
                new ApiError(
                  'レポートIDが指定されていません。',
                  'レポート画面の「印刷 / PDF保存」ボタンから開き直してください。',
                )
              }
            />
          </div>
        ) : null}

        {reportId && loading ? (
          <div aria-label="読み込み中">
            <SkeletonLines count={6} />
          </div>
        ) : null}

        {reports.error ? (
          <div className="no-print">
            <ErrorCard error={reports.error} onRetry={reports.retry} />
          </div>
        ) : null}

        {reportId && !loading && !reports.error && !report ? (
          <div className="no-print">
            <ErrorCard
              error={
                new ApiError(
                  '指定されたレポートが見つかりません。',
                  'レポート画面に戻り、対象のレポートから開き直してください。',
                )
              }
            />
          </div>
        ) : null}

        {report ? (
          <article>
            <header className="print-head">
              <div className="print-brand">ADGRID</div>
              <h1 className="print-title">
                {report.periodType === 'weekly' ? '週次' : '月次'}レポート
              </h1>
              <div className="print-meta">
                クライアント: {clientName} ／ 対象期間: {periodLabel(report)} ／ 生成:{' '}
                {formatDateTime(report.createdAt)}
                {report.mocked ? ' ／ ※AIモック結果 (デモ用)' : ''}
              </div>
            </header>

            <section className="print-section">
              <h2>エグゼクティブサマリ</h2>
              <p className="print-body">{report.result.executive_summary}</p>
            </section>

            {[...report.result.sections]
              .sort((a, b) => (SECTION_ORDER[a.kind] ?? 9) - (SECTION_ORDER[b.kind] ?? 9))
              .map((s, i) => (
                <section className="print-section" key={`${s.kind}-${i}`}>
                  <h2>{s.heading}</h2>
                  <p className="print-body">{s.body}</p>
                </section>
              ))}

            <footer className="print-foot">
              本レポートは ADGRID が実績データから自動生成しました。数値の根拠は管理画面のダッシュボードでご確認いただけます。
            </footer>
          </article>
        ) : null}
      </div>
    </div>
  );
}
