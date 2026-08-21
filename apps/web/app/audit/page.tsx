'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type {
  AdAccountDto,
  AuditFinding,
  AuditRunDto,
  CreateProposalInput,
  FindingStatus,
  ProposalAction,
  ProposalDto,
} from '@adgrid/shared';
import { useApi } from '@/components/use-api';
import { useClients } from '@/components/client-context';
import { ErrorCard, HintBar, MockBadge, PlatformTag, SkeletonLines } from '@/components/ui';
import { apiGet, apiPatch, apiPost, ApiError, toApiError } from '@/lib/api';
import { AUDIT_CATEGORY_LABEL, CONFIDENCE_LABEL, PROPOSAL_ACTION_LABEL } from '@/lib/labels';
import { formatDateTime } from '@/lib/format';

const PROPOSAL_ACTIONS: ProposalAction[] = ['adjust_budget', 'adjust_bid', 'pause_campaign'];

/* ---- 指摘から承認キューへの申請フォーム (S-20 / F-16) ---- */
function ProposalForm({
  finding,
  adAccountId,
  auditId,
}: {
  finding: AuditFinding;
  adAccountId: string;
  auditId: string;
}) {
  const [actionType, setActionType] = useState<ProposalAction>('adjust_budget');
  const [budget, setBudget] = useState('');
  const [percent, setPercent] = useState('');
  const [campaignId, setCampaignId] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [done, setDone] = useState(false);

  const buildPayload = (): Record<string, unknown> | null => {
    if (actionType === 'adjust_budget') {
      const v = Number(budget);
      return budget !== '' && Number.isFinite(v) && v > 0 ? { newMonthlyBudget: v } : null;
    }
    if (actionType === 'adjust_bid') {
      const v = Number(percent);
      return percent !== '' && Number.isFinite(v) && v >= -50 && v <= 50 && v !== 0
        ? { campaignId, percent: v }
        : null;
    }
    return { campaignId };
  };

  const submit = () => {
    const actionPayload = buildPayload();
    if (!actionPayload || sending) return;
    setSending(true);
    setError(null);
    const input: CreateProposalInput = {
      adAccountId,
      actionType,
      actionPayload,
      title: finding.title,
      evidence: finding.evidence.reasoning,
      risk: finding.risk,
      confidence: finding.confidence,
      sourceAuditId: auditId,
      sourceRank: finding.priority_rank,
    };
    apiPost<ProposalDto>('/proposals', input)
      .then(() => {
        setSending(false);
        setDone(true);
      })
      .catch((e: unknown) => {
        setError(toApiError(e));
        setSending(false);
      });
  };

  if (done) {
    return (
      <div className="alert info" style={{ marginTop: 10, marginBottom: 0 }}>
        <span className="a-ico" aria-hidden="true">●</span>
        <div>
          <span className="a-title">承認キューに追加しました</span>
          <br />
          <Link href="/approvals" style={{ fontSize: 12.5 }}>承認キューで確認する</Link>
        </div>
      </div>
    );
  }

  const fieldId = `propose-${finding.priority_rank}`;

  return (
    <div className="inline-form" style={{ marginTop: 10 }}>
      <div className="row-actions">
        <div className="field">
          <label htmlFor={`${fieldId}-action`}>アクション種別</label>
          <select
            id={`${fieldId}-action`}
            className="select"
            value={actionType}
            onChange={(e) => setActionType(e.target.value as ProposalAction)}
          >
            {PROPOSAL_ACTIONS.map((a) => (
              <option key={a} value={a}>{PROPOSAL_ACTION_LABEL[a]}</option>
            ))}
          </select>
        </div>
        {actionType === 'adjust_budget' ? (
          <div className="field">
            <label htmlFor={`${fieldId}-budget`}>新しい月予算 (円)</label>
            <input
              id={`${fieldId}-budget`}
              className="input num"
              type="number"
              min={1}
              style={{ width: 150 }}
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              placeholder="300000"
            />
          </div>
        ) : null}
        {actionType === 'adjust_bid' ? (
          <div className="field">
            <label htmlFor={`${fieldId}-percent`}>調整率 (%、-50〜50)</label>
            <input
              id={`${fieldId}-percent`}
              className="input num"
              type="number"
              min={-50}
              max={50}
              style={{ width: 130 }}
              value={percent}
              onChange={(e) => setPercent(e.target.value)}
              placeholder="-20"
            />
          </div>
        ) : null}
        {actionType === 'pause_campaign' ? (
          <div className="field">
            <label htmlFor={`${fieldId}-campaign`}>キャンペーンID (任意)</label>
            <input
              id={`${fieldId}-campaign`}
              className="input"
              type="text"
              style={{ width: 180 }}
              value={campaignId}
              onChange={(e) => setCampaignId(e.target.value)}
            />
          </div>
        ) : null}
        <div style={{ alignSelf: 'flex-end' }}>
          <button type="button" className="btn sm pri" disabled={sending || buildPayload() === null} onClick={submit}>
            {sending ? '送信中…' : '承認キューへ送る'}
          </button>
        </div>
      </div>
      {error ? (
        <div style={{ marginTop: 10 }}>
          <ErrorCard error={error} onRetry={submit} />
        </div>
      ) : null}
    </div>
  );
}

function FindingCard({
  finding,
  status,
  onSetStatus,
  updating,
  adAccountId,
  auditId,
}: {
  finding: AuditFinding;
  status: FindingStatus;
  onSetStatus: (rank: number, status: FindingStatus) => void;
  updating: boolean;
  adAccountId: string;
  auditId: string;
}) {
  const [proposeOpen, setProposeOpen] = useState(false);

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
        <button type="button" className="btn sm sec" onClick={() => setProposeOpen((o) => !o)}>
          {proposeOpen ? '申請フォームを閉じる' : '適用を申請'}
        </button>
      </div>

      {proposeOpen ? <ProposalForm finding={finding} adAccountId={adAccountId} auditId={auditId} /> : null}
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
          adAccountId={run.adAccountId}
          auditId={run.id}
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
  // オンボーディング完了画面などからの遷移 (?clientId=&accountId=) を反映する
  const [pendingAccountId, setPendingAccountId] = useState<string | null>(null);
  // 遷移直後は最新の診断結果を自動表示する (アハ体験を空状態で受けない)
  const [autoOpenLatest, setAutoOpenLatest] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const qClientId = params.get('clientId');
    const qAccountId = params.get('accountId');
    if (qClientId) setClientId(qClientId);
    if (qAccountId) {
      setPendingAccountId(qAccountId);
      setAutoOpenLatest(true);
      // accountId のみのディープリンク (ホーム等) はクライアントをAPIで解決する
      if (!qClientId) {
        apiGet<AdAccountDto>(`/clients/account/${encodeURIComponent(qAccountId)}`)
          .then((a) => setClientId(a.clientId))
          .catch(() => undefined);
      }
    }
  }, []);

  // トップバーでクライアントを切り替えたら診断対象にも反映する。
  // ただしディープリンク解決中 (pendingAccountId が残っている間) は上書きしない
  useEffect(() => {
    if (selectedClientId && !pendingAccountId) setClientId(selectedClientId);
  }, [selectedClientId, pendingAccountId]);

  const accounts = useApi<AdAccountDto[]>(clientId ? `/clients/${clientId}/accounts` : null);

  useEffect(() => {
    setAdAccountId('');
  }, [clientId]);

  // アカウント一覧の取得後に、URLで指定されたアカウントを選択状態にする。
  // 一覧に対象が無い場合は「別クライアントの一覧」の可能性があるため pending を消さない
  useEffect(() => {
    if (!pendingAccountId || !accounts.data) return;
    if (accounts.data.some((a) => a.id === pendingAccountId)) {
      setAdAccountId(pendingAccountId);
      setPendingAccountId(null);
    }
  }, [pendingAccountId, accounts.data]);

  const history = useApi<AuditRunDto[]>(adAccountId ? `/audits?adAccountId=${encodeURIComponent(adAccountId)}` : '/audits');

  useEffect(() => {
    if (!autoOpenLatest || run || !adAccountId || !history.data) return;
    const latest = history.data.find((h) => h.adAccountId === adAccountId);
    if (latest) setRun(latest);
    setAutoOpenLatest(false);
  }, [autoOpenLatest, run, adAccountId, history.data]);

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

      <HintBar id="audit" title="AI診断の使い方">
        アカウントを選んで<mark>「診断を実行」</mark>すると、AIが改善点を優先度順に提案します。各指摘には根拠・期待効果・リスク・確信度が付きます。良い指摘は<mark>「対応済にする」</mark>、不要なら「見送る」。承認フローに載せたい提案は「適用を申請」から。
      </HintBar>

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
