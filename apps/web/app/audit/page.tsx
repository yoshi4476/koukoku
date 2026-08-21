'use client';

import { useEffect, useState } from 'react';
import type { AdAccountDto, AuditFinding, AuditRunDto, FindingStatus } from '@adgrid/shared';
import { useApi } from '@/components/use-api';
import { useClients } from '@/components/client-context';
import { ErrorCard, MockBadge, PlatformTag, SkeletonLines } from '@/components/ui';
import { apiPatch, apiPost, ApiError, toApiError } from '@/lib/api';
import { AUDIT_CATEGORY_LABEL, CONFIDENCE_LABEL } from '@/lib/labels';
import { formatDateTime } from '@/lib/format';

function FindingCard({
  finding,
  status,
  onSetStatus,
  updating,
}: {
  finding: AuditFinding;
  status: FindingStatus;
  onSetStatus: (rank: number, status: FindingStatus) => void;
  updating: boolean;
}) {
  return (
    <div className={`finding st-${status}`}>
      <div className="f-head">
        <span className="f-rank">#{finding.priority_rank}</span>
        <span className="f-title">{finding.title}</span>
        <span className="tag">{AUDIT_CATEGORY_LABEL[finding.category] ?? finding.category}</span>
        <span className={`pill ${finding.confidence === 'high' ? 'ai' : 'flat'}`}>
          {CONFIDENCE_LABEL[finding.confidence] ?? finding.confidence}
        </span>
        {status === 'adopted' ? <span className="pill up">対応済</span> : null}
        {status === 'dismissed' ? <span className="pill flat">見送り</span> : null}
      </div>
      <p style={{ margin: 0, fontSize: 13 }}>{finding.body}</p>

      <div className="f-block">
        <span className="f-label">根拠データ</span>
        <div className="metric-cites">
          {finding.evidence.metrics_cited.map((m, i) => (
            <span className="metric-cite" key={i}>
              {m.name} {m.value} ({m.period})
            </span>
          ))}
        </div>
        <span style={{ color: 'var(--ink-2)' }}>{finding.evidence.reasoning}</span>
      </div>
      <div className="f-block">
        <span className="f-label">期待効果</span>
        <span style={{ color: 'var(--good)' }}>{finding.expected_impact}</span>
      </div>
      <div className="f-block">
        <span className="f-label">リスク</span>
        <span style={{ color: 'var(--ink-2)' }}>{finding.risk}</span>
      </div>

      <div className="f-actions">
        {status === 'open' ? (
          <>
            <button type="button" className="btn sm pri" disabled={updating} onClick={() => onSetStatus(finding.priority_rank, 'adopted')}>
              対応済にする
            </button>
            <button type="button" className="btn sm sec" disabled={updating} onClick={() => onSetStatus(finding.priority_rank, 'dismissed')}>
              見送る
            </button>
          </>
        ) : (
          <button type="button" className="btn sm sec" disabled={updating} onClick={() => onSetStatus(finding.priority_rank, 'open')}>
            未対応に戻す
          </button>
        )}
      </div>
    </div>
  );
}

function RunResult({ run, onUpdated }: { run: AuditRunDto; onUpdated: (r: AuditRunDto) => void }) {
  const [updating, setUpdating] = useState(false);
  const [patchError, setPatchError] = useState<ApiError | null>(null);

  const setStatus = (rank: number, status: FindingStatus) => {
    setUpdating(true);
    setPatchError(null);
    apiPatch<AuditRunDto>(`/audits/${run.id}/findings/${rank}`, { status })
      .then((updated) => {
        onUpdated(updated);
        setUpdating(false);
      })
      .catch((e: unknown) => {
        setPatchError(toApiError(e));
        setUpdating(false);
      });
  };

  const findings = [...run.result.findings].sort((a, b) => a.priority_rank - b.priority_rank);

  return (
    <>
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="c-head">
          <h2>診断サマリ</h2>
          {run.mocked ? <MockBadge /> : null}
          <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--muted)' }} className="num">
            {formatDateTime(run.createdAt)} · {run.model} · {run.promptVersion}
          </span>
        </div>
        <div className="c-body">
          <p style={{ margin: 0 }}>{run.result.summary}</p>
          <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--muted)' }}>
            対象期間: {run.result.diagnosis_scope.period} · データ充足度: {run.result.diagnosis_scope.data_sufficiency === 'full' ? '十分' : '限定的'}
            {run.result.diagnosis_scope.excluded_categories.length > 0
              ? ` · 対象外: ${run.result.diagnosis_scope.excluded_categories.join('、')}`
              : ''}
          </p>
        </div>
      </div>

      {patchError ? <ErrorCard error={patchError} /> : null}

      {findings.map((f) => (
        <FindingCard
          key={f.priority_rank}
          finding={f}
          status={run.findingStatuses[f.priority_rank] ?? 'open'}
          onSetStatus={setStatus}
          updating={updating}
        />
      ))}

      {run.result.data_requests.length > 0 ? (
        <div className="card section-gap">
          <div className="c-head"><h2>追加で必要なデータ</h2></div>
          <div className="c-body">
            <ul style={{ margin: 0, paddingLeft: '1.4em' }}>
              {run.result.data_requests.map((d, i) => (
                <li key={i} style={{ fontSize: 12.5 }}>
                  <b>{d.needed_data}</b> — {d.reason}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </>
  );
}

export default function AuditPage() {
  const { clients, loading: clientsLoading, error: clientsError, reload, selectedClientId } = useClients();
  const [clientId, setClientId] = useState('');
  const [adAccountId, setAdAccountId] = useState('');
  const [run, setRun] = useState<AuditRunDto | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<ApiError | null>(null);

  // トップバーでクライアントを切り替えたら診断対象にも反映する
  useEffect(() => {
    if (selectedClientId) setClientId(selectedClientId);
  }, [selectedClientId]);

  const accounts = useApi<AdAccountDto[]>(clientId ? `/clients/${clientId}/accounts` : null);

  useEffect(() => {
    setAdAccountId('');
  }, [clientId]);

  const history = useApi<AuditRunDto[]>(adAccountId ? `/audits?adAccountId=${encodeURIComponent(adAccountId)}` : '/audits');

  const runAudit = () => {
    if (!adAccountId) return;
    setRunning(true);
    setRunError(null);
    setRun(null);
    apiPost<AuditRunDto>('/audits/run', { adAccountId })
      .then((r) => {
        setRun(r);
        setRunning(false);
        history.retry();
      })
      .catch((e: unknown) => {
        setRunError(toApiError(e));
        setRunning(false);
      });
  };

  const accountList = accounts.data ?? [];

  return (
    <>
      <div className="page-h">
        <h1>AI診断</h1>
        <span className="sub">実績データから改善点を優先度順に提案します</span>
      </div>

      {clientsError ? <ErrorCard error={clientsError} onRetry={reload} /> : null}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="c-body row-actions">
          <div className="field">
            <label htmlFor="audit-client">クライアント</label>
            <select id="audit-client" className="select" value={clientId} onChange={(e) => setClientId(e.target.value)} disabled={clientsLoading}>
              <option value="">選択してください</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="audit-account">広告アカウント</label>
            <select
              id="audit-account"
              className="select"
              value={adAccountId}
              onChange={(e) => setAdAccountId(e.target.value)}
              disabled={!clientId || accounts.loading}
            >
              <option value="">{accounts.loading ? '読み込み中…' : '選択してください'}</option>
              {accountList.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
          <div style={{ alignSelf: 'flex-end' }}>
            <button type="button" className="btn pri" onClick={runAudit} disabled={!adAccountId || running}>
              {running ? '診断中…' : '診断を実行'}
            </button>
          </div>
        </div>
        {accounts.error ? (
          <div className="c-body" style={{ paddingTop: 0 }}>
            <ErrorCard error={accounts.error} onRetry={accounts.retry} />
          </div>
        ) : null}
      </div>

      {runError ? <ErrorCard error={runError} onRetry={runAudit} /> : null}

      {running ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="c-body">
            <p style={{ margin: '0 0 12px', fontWeight: 600, color: 'var(--primary)' }}>実績データを分析中… (数十秒かかる場合があります)</p>
            <SkeletonLines count={5} />
          </div>
        </div>
      ) : null}

      {run ? <RunResult run={run} onUpdated={setRun} /> : null}

      {!run && !running && !runError ? (
        <div className="empty" style={{ marginBottom: 16 }}>
          <div className="e-title">まだ診断結果を表示していません</div>
          <div className="e-sub">アカウントを選んで診断を実行すると、AIが改善点を優先度順に提案します。</div>
        </div>
      ) : null}

      <div className="card section-gap">
        <div className="c-head"><h2>診断履歴</h2></div>
        {history.loading ? (
          <div className="c-body"><SkeletonLines count={3} /></div>
        ) : history.error ? (
          <div className="c-body"><ErrorCard error={history.error} onRetry={history.retry} /></div>
        ) : (history.data ?? []).length === 0 ? (
          <div className="c-body" style={{ color: 'var(--muted)', fontSize: 12.5 }}>まだ診断履歴がありません。</div>
        ) : (
          <div>
            {(history.data ?? []).map((h) => {
              const account = accountList.find((a) => a.id === h.adAccountId);
              return (
                <button type="button" key={h.id} className="history-item" onClick={() => setRun(h)}>
                  <span className="h-date num">{formatDateTime(h.createdAt)}</span>
                  {account ? <PlatformTag platform={account.platform} /> : null}
                  <span style={{ flex: 1, minWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {h.result.summary}
                  </span>
                  <span className="pill flat num">指摘 {h.result.findings.length}件</span>
                  {h.mocked ? <MockBadge /> : null}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
