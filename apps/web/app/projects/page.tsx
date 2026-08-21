'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import type { AdAccountDto, ClientDto, CreateProjectInput, ProjectDto, ProjectGoal } from '@adgrid/shared';
import { PROJECT_GOAL_LABEL, PROJECT_STATUS_LABEL } from '@adgrid/shared';
import { useApi } from '@/components/use-api';
import { useClients } from '@/components/client-context';
import { DeltaPill, EmptyState, ErrorCard, HintBar, PlatformTag, SkeletonLines } from '@/components/ui';
import { apiGet, apiPost, ApiError, toApiError } from '@/lib/api';
import { INDUSTRY_LABEL } from '@/lib/labels';
import { formatNumber, formatYen } from '@/lib/format';

const GOALS: ProjectGoal[] = ['conversion', 'awareness', 'traffic', 'store'];

const STATUS_CLS: Record<string, string> = { active: 'up', paused: 'warn', ended: 'flat' };

function CreateProjectForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const { clients } = useClients();
  const [name, setName] = useState('');
  const [clientId, setClientId] = useState('');
  const [goal, setGoal] = useState<ProjectGoal>('conversion');
  const [accounts, setAccounts] = useState<AdAccountDto[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    if (!clientId) {
      setAccounts([]);
      setSelected(new Set());
      return;
    }
    apiGet<AdAccountDto[]>(`/clients/${clientId}/accounts`)
      .then((a) => {
        setAccounts(a);
        setSelected(new Set(a.map((x) => x.id)));
      })
      .catch(() => setAccounts([]));
  }, [clientId]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    const body: CreateProjectInput = { name: name.trim(), clientId, goal, accountIds: [...selected] };
    apiPost<ProjectDto>('/projects', body)
      .then(() => onDone())
      .catch((err: unknown) => {
        setError(toApiError(err));
        setSubmitting(false);
      });
  };

  return (
    <form className="card proj-form" onSubmit={submit}>
      <div className="c-head"><h2>プロジェクトを作成</h2></div>
      <div className="c-body form-grid">
        {error ? <ErrorCard error={error} /> : null}
        <div className="field">
          <label htmlFor="pj-name">プロジェクト名</label>
          <input id="pj-name" className="input" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="例: 春の新規獲得キャンペーン" required />
        </div>
        <div className="proj-form-row">
          <div className="field">
            <label htmlFor="pj-client">クライアント</label>
            <select id="pj-client" className="select" value={clientId} onChange={(e) => setClientId(e.target.value)} required>
              <option value="">選択してください</option>
              {clients.map((c: ClientDto) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="pj-goal">目的</label>
            <select id="pj-goal" className="select" value={goal} onChange={(e) => setGoal(e.target.value as ProjectGoal)}>
              {GOALS.map((g) => <option key={g} value={g}>{PROJECT_GOAL_LABEL[g]}</option>)}
            </select>
          </div>
        </div>
        {clientId ? (
          <div className="field">
            <label>まとめる媒体アカウント</label>
            {accounts.length === 0 ? (
              <p style={{ margin: 0, fontSize: 12.5, color: 'var(--muted)' }}>
                このクライアントには媒体アカウントがありません。先に「クライアント」画面で追加してください。
              </p>
            ) : (
              <div className="proj-acct-pick">
                {accounts.map((a) => (
                  <label key={a.id} className={`proj-acct-opt${selected.has(a.id) ? ' on' : ''}`}>
                    <input type="checkbox" checked={selected.has(a.id)} onChange={() => toggle(a.id)} />
                    <PlatformTag platform={a.platform} />
                    <span>{a.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        ) : null}
        <div className="f-actions">
          <button type="submit" className="btn pri" disabled={submitting || !name.trim() || !clientId}>
            {submitting ? '作成中…' : 'プロジェクトを作成'}
          </button>
          <button type="button" className="btn sec" onClick={onCancel}>キャンセル</button>
        </div>
      </div>
    </form>
  );
}

function ProjectCard({ p }: { p: ProjectDto }) {
  return (
    <Link href={`/projects/${p.id}`} className="proj-card">
      <div className="proj-card-head">
        <span className={`pill ${STATUS_CLS[p.status] ?? 'flat'}`}>{PROJECT_STATUS_LABEL[p.status]}</span>
        <span className="proj-goal">🎯 {PROJECT_GOAL_LABEL[p.goal]}</span>
        {p.alertCount > 0 ? <span className="pill down" style={{ marginLeft: 'auto' }}>⚠ アラート{p.alertCount}</span> : null}
        {p.openFindings > 0 ? <span className="pill warn" style={{ marginLeft: p.alertCount > 0 ? 0 : 'auto' }}>改善{p.openFindings}</span> : null}
      </div>
      <div className="proj-name">{p.name}</div>
      <div className="proj-sub">
        {p.clientName} <span className="proj-ind">{INDUSTRY_LABEL[p.industryCode] ?? p.industryCode}</span>
      </div>
      <div className="proj-plats">
        {p.platforms.map((pl) => <PlatformTag key={pl} platform={pl} />)}
        <span className="proj-acct-n">媒体{p.accountCount}件</span>
      </div>
      {p.assetCount > 0 ? (
        <div className="proj-assets-line">
          📎 制作物{p.assetCount}件{p.publishedCount > 0 ? <span className="pill up">公開中{p.publishedCount}</span> : null}
        </div>
      ) : null}
      <div className="proj-kpis">
        <div><div className="pk-l">消化 (7日)</div><div className="pk-v">{formatYen(p.cost7d)}</div></div>
        <div><div className="pk-l">CV</div><div className="pk-v">{formatNumber(p.conversions7d)}</div></div>
        <div><div className="pk-l">CPA</div><div className="pk-v">{formatYen(p.cpa7d)}<DeltaPill value={p.cpaDelta} invert /></div></div>
      </div>
    </Link>
  );
}

export default function ProjectsPage() {
  const projects = useApi<ProjectDto[]>('/projects');
  const [showForm, setShowForm] = useState(false);
  const list = projects.data ?? [];

  return (
    <>
      <div className="page-h">
        <h1>プロジェクト</h1>
        <span className="sub">施策ごとに媒体をまとめ、掲示・推移・アラート・改善を1か所で</span>
        <button type="button" className="btn pri" style={{ marginLeft: 'auto' }} onClick={() => setShowForm((v) => !v)}>
          {showForm ? '閉じる' : '＋ プロジェクトを作成'}
        </button>
      </div>

      <HintBar id="projects" title="プロジェクトの使い方">
        プロジェクトは<mark>「1つの目的（施策）」の単位</mark>です。関係する媒体（Google・Metaなど）をまとめておくと、そのプロジェクトを開くだけで<mark>掲示（配信状況）・推移・アラート・改善</mark>がひと目でわかります。まずは<mark>「＋ プロジェクトを作成」</mark>から。
      </HintBar>

      {showForm ? <CreateProjectForm onDone={() => { setShowForm(false); projects.retry(); }} onCancel={() => setShowForm(false)} /> : null}

      {projects.error ? <ErrorCard error={projects.error} onRetry={projects.retry} /> : null}
      {projects.loading ? <div className="card"><div className="c-body"><SkeletonLines count={4} /></div></div> : null}

      {projects.data && list.length === 0 && !showForm ? (
        <EmptyState
          title="まだプロジェクトがありません"
          sub="施策（例: 春の新規獲得キャンペーン）ごとにプロジェクトを作り、媒体をまとめましょう。"
          action={<button className="btn pri" onClick={() => setShowForm(true)}>＋ プロジェクトを作成</button>}
        />
      ) : null}

      {list.length > 0 ? (
        <div className="proj-grid">
          {list.map((p) => <ProjectCard key={p.id} p={p} />)}
        </div>
      ) : null}
    </>
  );
}
