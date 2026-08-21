'use client';

import { useEffect, useRef, useState } from 'react';
import type { AdAccountDto, CsvImportResultDto } from '@adgrid/shared';
import { useApi } from '@/components/use-api';
import { useClients } from '@/components/client-context';
import { ErrorCard, SkeletonLines } from '@/components/ui';
import { apiUpload, ApiError, toApiError } from '@/lib/api';
import { formatNumber } from '@/lib/format';

export default function ImportPage() {
  const { clients, loading: clientsLoading, error: clientsError, reload, selectedClientId } = useClients();
  const [clientId, setClientId] = useState('');
  const [adAccountId, setAdAccountId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<CsvImportResultDto | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<ApiError | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // クライアント管理などからの遷移 (?clientId=) では先頭アカウントを自動選択する
  const [autoSelectAccount, setAutoSelectAccount] = useState(false);

  useEffect(() => {
    const qClientId = new URLSearchParams(window.location.search).get('clientId');
    if (qClientId) {
      setClientId(qClientId);
      setAutoSelectAccount(true);
    }
  }, []);

  useEffect(() => {
    if (selectedClientId) setClientId(selectedClientId);
  }, [selectedClientId]);

  const accounts = useApi<AdAccountDto[]>(clientId ? `/clients/${clientId}/accounts` : null);

  useEffect(() => {
    setAdAccountId('');
  }, [clientId]);

  useEffect(() => {
    if (!autoSelectAccount || !accounts.data) return;
    const first = accounts.data[0];
    if (first) setAdAccountId(first.id);
    setAutoSelectAccount(false);
  }, [autoSelectAccount, accounts.data]);

  const canUpload = adAccountId !== '' && file !== null && !uploading;

  const upload = () => {
    if (!adAccountId || !file) return;
    setUploading(true);
    setUploadError(null);
    setResult(null);
    const form = new FormData();
    form.append('file', file);
    form.append('adAccountId', adAccountId);
    apiUpload<CsvImportResultDto>('/imports/csv', form)
      .then((r) => {
        setResult(r);
        setUploading(false);
        setFile(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
      })
      .catch((e: unknown) => {
        setUploadError(toApiError(e));
        setUploading(false);
      });
  };

  return (
    <>
      <div className="page-h">
        <h1>データ取込 (CSV)</h1>
        <span className="sub">各媒体の管理画面からダウンロードしたCSVを取り込みます (Shift_JIS / UTF-8 自動判別)</span>
      </div>

      {clientsError ? <ErrorCard error={clientsError} onRetry={reload} /> : null}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="c-body form-grid">
          <div className="row-actions">
            <div className="field">
              <label htmlFor="import-client">クライアント</label>
              <select id="import-client" className="select" value={clientId} onChange={(e) => setClientId(e.target.value)} disabled={clientsLoading}>
                <option value="">選択してください</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="import-account">広告アカウント</label>
              <select
                id="import-account"
                className="select"
                value={adAccountId}
                onChange={(e) => setAdAccountId(e.target.value)}
                disabled={!clientId || accounts.loading}
              >
                <option value="">{accounts.loading ? '読み込み中…' : '選択してください'}</option>
                {(accounts.data ?? []).map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
          </div>
          {accounts.error ? <ErrorCard error={accounts.error} onRetry={accounts.retry} /> : null}

          <div className="field">
            <label htmlFor="import-file">CSVファイル</label>
            <input
              id="import-file"
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="input"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>

          <div>
            <button type="button" className="btn pri" onClick={upload} disabled={!canUpload}>
              {uploading ? '取込中…' : 'CSVを取り込む'}
            </button>
          </div>
        </div>
      </div>

      {uploadError ? <ErrorCard error={uploadError} onRetry={upload} /> : null}

      {uploading ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="c-body">
            <p style={{ margin: '0 0 12px', fontWeight: 600, color: 'var(--primary)' }}>フォーマットを判別して取り込み中…</p>
            <SkeletonLines count={3} />
          </div>
        </div>
      ) : null}

      {result ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="c-head">
            <h2>取込結果</h2>
            <span className="pill up">取込完了</span>
          </div>
          <div className="c-body form-grid">
            <div className="result-stat">
              <div className="rs">
                <div className="rs-label">検出フォーマット</div>
                <div className="rs-val" style={{ fontSize: 14 }}>{result.detectedFormat}</div>
              </div>
              <div className="rs">
                <div className="rs-label">エンコーディング</div>
                <div className="rs-val" style={{ fontSize: 14 }}>{result.encoding === 'sjis' ? 'Shift_JIS' : 'UTF-8'}</div>
              </div>
              <div className="rs">
                <div className="rs-label">読込行数</div>
                <div className="rs-val">{formatNumber(result.rowCount)}</div>
              </div>
              <div className="rs">
                <div className="rs-label">取込行数</div>
                <div className="rs-val" style={{ color: 'var(--good)' }}>{formatNumber(result.insertedRows)}</div>
              </div>
              <div className="rs">
                <div className="rs-label">エラー行数</div>
                <div className="rs-val" style={result.errorRows > 0 ? { color: 'var(--bad)' } : undefined}>
                  {formatNumber(result.errorRows)}
                </div>
              </div>
            </div>
            {result.warnings.length > 0 ? (
              <div className="alert warn" style={{ marginBottom: 0 }}>
                <span className="a-ico" aria-hidden="true">▲</span>
                <div>
                  <span className="a-title">取込時の警告 ({result.warnings.length}件)</span>
                  <ul style={{ margin: '4px 0 0', paddingLeft: '1.4em' }}>
                    {result.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {!result && !uploading && !uploadError ? (
        <div className="empty">
          <div className="e-title">CSVを取り込んでダッシュボードに反映します</div>
          <div className="e-sub">アカウントとファイルを選ぶと、フォーマットと文字コードを自動判別して取り込みます。</div>
        </div>
      ) : null}
    </>
  );
}
