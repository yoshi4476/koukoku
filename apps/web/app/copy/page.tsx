'use client';

import { useEffect, useState } from 'react';
import type { CopyCandidate, CopyRunDto, LawIssue, Platform } from '@adgrid/shared';
import { ALL_PLATFORMS, APPEAL_AXES, PLATFORM_META } from '@adgrid/shared';
import { useClients } from '@/components/client-context';
import { ErrorCard, MockBadge, PlatformTag, SkeletonLines } from '@/components/ui';
import { apiPost, ApiError, toApiError } from '@/lib/api';
import { CONFIDENCE_LABEL } from '@/lib/labels';

function LawIssueNote({ issue }: { issue: LawIssue }) {
  return (
    <div className={`law-issue ${issue.severity}`}>
      <b>{issue.severity === 'block' ? '要修正' : '注意'} · {issue.law}</b> — 「{issue.expression}」
      <br />
      理由: {issue.reason}
      <br />
      修正案: {issue.suggestion}
      <span style={{ marginLeft: 8, fontSize: 11 }}>({CONFIDENCE_LABEL[issue.confidence] ?? issue.confidence})</span>
    </div>
  );
}

function CandidateCard({
  candidate,
  index,
  check,
}: {
  candidate: CopyCandidate;
  index: number;
  check: { headlineOk: boolean; descriptionOk: boolean } | undefined;
}) {
  const headlineOk = check?.headlineOk ?? true;
  const descriptionOk = check?.descriptionOk ?? true;
  const hasBlock = candidate.law_issues.some((i) => i.severity === 'block');
  return (
    <div className="cand">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
        <span className="pill ai">案 {index + 1}</span>
        <span className="tag">{candidate.appeal_axis}</span>
        {hasBlock ? <span className="pill down">出稿不可の表現あり</span> : null}
      </div>
      <div className="cd-headline">{candidate.headline}</div>
      <span className={`char-count${headlineOk ? '' : ' over'}`}>
        見出し {candidate.headline.length}文字{headlineOk ? '' : ' — 文字数超過'}
      </span>
      <div className="cd-desc">{candidate.description}</div>
      <span className={`char-count${descriptionOk ? '' : ' over'}`}>
        説明文 {candidate.description.length}文字{descriptionOk ? '' : ' — 文字数超過'}
      </span>
      {candidate.law_issues.map((issue, i) => (
        <LawIssueNote key={i} issue={issue} />
      ))}
    </div>
  );
}

export default function CopyPage() {
  const { clients, loading: clientsLoading, error: clientsError, reload, selectedClientId } = useClients();
  const [clientId, setClientId] = useState('');
  const [platform, setPlatform] = useState<Platform>('google_ads');
  const [productInfo, setProductInfo] = useState('');
  const [axes, setAxes] = useState<string[]>(['便益']);
  const [count, setCount] = useState(3);
  const [run, setRun] = useState<CopyRunDto | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<ApiError | null>(null);

  useEffect(() => {
    if (selectedClientId) setClientId(selectedClientId);
  }, [selectedClientId]);

  const toggleAxis = (axis: string) => {
    setAxes((prev) => (prev.includes(axis) ? prev.filter((a) => a !== axis) : [...prev, axis]));
  };

  const canRun = clientId !== '' && productInfo.trim().length > 0 && axes.length > 0 && !running;

  const runCopy = () => {
    if (!canRun) return;
    setRunning(true);
    setRunError(null);
    setRun(null);
    apiPost<CopyRunDto>('/copies/run', {
      clientId,
      platform,
      productInfo: productInfo.trim(),
      appealAxes: axes,
      count,
    })
      .then((r) => {
        setRun(r);
        setRunning(false);
      })
      .catch((e: unknown) => {
        setRunError(toApiError(e));
        setRunning(false);
      });
  };

  const checkFor = (index: number) => run?.lengthChecks.find((c) => c.index === index);

  return (
    <>
      <div className="page-h">
        <h1>広告文スタジオ</h1>
        <span className="sub">訴求軸ごとに広告文を生成し、文字数と法規制を自動チェックします</span>
      </div>

      {clientsError ? <ErrorCard error={clientsError} onRetry={reload} /> : null}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="c-body form-grid">
          <div className="row-actions">
            <div className="field">
              <label htmlFor="copy-client">クライアント</label>
              <select id="copy-client" className="select" value={clientId} onChange={(e) => setClientId(e.target.value)} disabled={clientsLoading}>
                <option value="">選択してください</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="copy-platform">媒体</label>
              <select id="copy-platform" className="select" value={platform} onChange={(e) => setPlatform(e.target.value as Platform)}>
                {ALL_PLATFORMS.map((p) => (
                  <option key={p} value={p}>{PLATFORM_META[p].label}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="copy-count">案数</label>
              <select id="copy-count" className="select" value={count} onChange={(e) => setCount(Number(e.target.value))}>
                {[1, 2, 3, 5, 8].map((n) => (
                  <option key={n} value={n}>{n}案</option>
                ))}
              </select>
            </div>
          </div>

          <div className="field">
            <label htmlFor="copy-product">商材情報</label>
            <textarea
              id="copy-product"
              className="textarea"
              placeholder="例: オンライン英会話サービス。月額6,980円、初回7日間無料。ビジネス英語に特化し、講師は全員TESOL保有。"
              value={productInfo}
              onChange={(e) => setProductInfo(e.target.value)}
            />
          </div>

          <div className="field">
            <label>訴求軸 (複数選択可)</label>
            <div className="check-group">
              {APPEAL_AXES.map((axis) => {
                const on = axes.includes(axis);
                return (
                  <label key={axis} className={`check-chip${on ? ' on' : ''}`}>
                    <input type="checkbox" checked={on} onChange={() => toggleAxis(axis)} />
                    {axis}
                  </label>
                );
              })}
            </div>
          </div>

          <div>
            <button type="button" className="btn pri" onClick={runCopy} disabled={!canRun}>
              {running ? '生成中…' : '広告文を生成'}
            </button>
          </div>
        </div>
      </div>

      {runError ? <ErrorCard error={runError} onRetry={runCopy} /> : null}

      {running ? (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="c-body">
            <p style={{ margin: '0 0 12px', fontWeight: 600, color: 'var(--primary)' }}>広告文を生成し、法規制をチェック中…</p>
            <SkeletonLines count={4} />
          </div>
        </div>
      ) : null}

      {run ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
            <PlatformTag platform={run.platform} full />
            <span className="pill flat num">{run.result.candidates.length}案</span>
            {run.mocked ? <MockBadge /> : null}
          </div>
          <div style={{ display: 'grid', gap: 12 }}>
            {run.result.candidates.map((cand, i) => (
              <CandidateCard key={i} candidate={cand} index={i} check={checkFor(i)} />
            ))}
          </div>
        </>
      ) : null}

      {!run && !running && !runError ? (
        <div className="empty">
          <div className="e-title">まだ広告文を生成していません</div>
          <div className="e-sub">商材情報と訴求軸を入力して生成すると、媒体の文字数制限と法規制を自動でチェックします。</div>
        </div>
      ) : null}

      <p className="disclaimer">本チェックは参考情報であり法的助言ではありません。出稿前に必ず社内の審査基準および各媒体の広告ポリシーをご確認ください。</p>
    </>
  );
}
