'use client';

import { Fragment, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import type {
  AbArmInput,
  AbTestDto,
  CreateAbTestInput,
  KnowledgeAssetDto,
  KnowledgeObjective,
  PromoteAbTestInput,
} from '@adgrid/shared';
import { useApi } from '@/components/use-api';
import { useClients } from '@/components/client-context';
import { EmptyState, ErrorCard, SkeletonLines } from '@/components/ui';
import { apiPost, ApiError, toApiError } from '@/lib/api';
import { KNOWLEDGE_OBJECTIVE_LABEL } from '@/lib/labels';
import { formatNumber, formatPercent } from '@/lib/format';

const OBJECTIVES: KnowledgeObjective[] = ['conversion', 'awareness', 'traffic'];

const METRIC_LABEL: Record<AbTestDto['metric'], string> = { cvr: 'CVR', ctr: 'CTR' };

/** 相対リフトを符号付きで表示 */
function liftText(lift: number | null): string | null {
  if (lift === null) return null;
  const sign = lift > 0 ? '+' : '';
  return `${sign}${lift.toFixed(1)}%`;
}

interface ArmFields {
  label: string;
  impressions: string;
  clicks: string;
  conversions: string;
}

const EMPTY_ARM: ArmFields = { label: '', impressions: '', clicks: '', conversions: '' };

function toArmInput(fields: ArmFields, fallbackLabel: string): AbArmInput {
  return {
    label: fields.label.trim() || fallbackLabel,
    impressions: Number(fields.impressions) || 0,
    clicks: Number(fields.clicks) || 0,
    conversions: Number(fields.conversions) || 0,
  };
}

/* ---- アーム入力 (表示回数・クリック・CV) ---- */
function ArmInputs({
  arm,
  fields,
  onChange,
  disabled,
}: {
  arm: 'a' | 'b';
  fields: ArmFields;
  onChange: (next: ArmFields) => void;
  disabled: boolean;
}) {
  const upper = arm.toUpperCase();
  const set = (key: keyof ArmFields, value: string) => onChange({ ...fields, [key]: value });
  return (
    <div className="ab-arm-form">
      <div className="ab-arm-form-h">アーム{upper}</div>
      <div className="field">
        <label htmlFor={`arm-${arm}-label`}>ラベル</label>
        <input
          id={`arm-${arm}-label`}
          className="input"
          type="text"
          value={fields.label}
          onChange={(e) => set('label', e.target.value)}
          placeholder={arm === 'a' ? '例: 既存パターン' : '例: 新パターン'}
          disabled={disabled}
        />
      </div>
      <div className="row-actions">
        <div className="field">
          <label htmlFor={`arm-${arm}-imp`}>表示回数</label>
          <input id={`arm-${arm}-imp`} className="input num" type="number" min={0} value={fields.impressions} onChange={(e) => set('impressions', e.target.value)} placeholder="0" disabled={disabled} />
        </div>
        <div className="field">
          <label htmlFor={`arm-${arm}-clk`}>クリック</label>
          <input id={`arm-${arm}-clk`} className="input num" type="number" min={0} value={fields.clicks} onChange={(e) => set('clicks', e.target.value)} placeholder="0" disabled={disabled} />
        </div>
        <div className="field">
          <label htmlFor={`arm-${arm}-cv`}>CV</label>
          <input id={`arm-${arm}-cv`} className="input num" type="number" min={0} value={fields.conversions} onChange={(e) => set('conversions', e.target.value)} placeholder="0" disabled={disabled} />
        </div>
      </div>
    </div>
  );
}

/* ---- 新規テスト作成フォーム ---- */
function CreateForm({ onDone }: { onDone: () => void }) {
  const { clients, selectedClientId } = useClients();
  const [clientId, setClientId] = useState(selectedClientId);
  const [name, setName] = useState('');
  const [hypothesis, setHypothesis] = useState('');
  const [metric, setMetric] = useState<AbTestDto['metric']>('cvr');
  const [armA, setArmA] = useState<ArmFields>(EMPTY_ARM);
  const [armB, setArmB] = useState<ArmFields>(EMPTY_ARM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    if (selectedClientId) setClientId(selectedClientId);
  }, [selectedClientId]);

  const canSave = clientId !== '' && name.trim().length > 0 && !saving;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError(null);
    const body: CreateAbTestInput = {
      clientId,
      name: name.trim(),
      metric,
      a: toArmInput(armA, 'アームA'),
      b: toArmInput(armB, 'アームB'),
      ...(hypothesis.trim() ? { hypothesis: hypothesis.trim() } : {}),
    };
    apiPost<AbTestDto>('/abtests', body)
      .then(() => {
        setSaving(false);
        setName('');
        setHypothesis('');
        setArmA(EMPTY_ARM);
        setArmB(EMPTY_ARM);
        onDone();
      })
      .catch((err: unknown) => {
        setError(toApiError(err));
        setSaving(false);
      });
  };

  return (
    <form className="inline-form form-grid" style={{ marginBottom: 16 }} onSubmit={submit}>
      {error ? <ErrorCard error={error} /> : null}
      <div className="row-actions">
        <div className="field">
          <label htmlFor="ab-client">クライアント</label>
          <select id="ab-client" className="select" value={clientId} onChange={(e) => setClientId(e.target.value)} disabled={saving}>
            <option value="">選択してください</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div className="field" style={{ flex: '1 1 220px' }}>
          <label htmlFor="ab-name">テスト名</label>
          <input id="ab-name" className="input" type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="例: LP見出しABテスト" disabled={saving} style={{ width: '100%' }} />
        </div>
        <div className="field">
          <label htmlFor="ab-metric">指標</label>
          <select id="ab-metric" className="select" value={metric} onChange={(e) => setMetric(e.target.value as AbTestDto['metric'])} disabled={saving}>
            <option value="cvr">CVR</option>
            <option value="ctr">CTR</option>
          </select>
        </div>
      </div>
      <div className="field">
        <label htmlFor="ab-hyp">仮説 (任意)</label>
        <input id="ab-hyp" className="input" type="text" value={hypothesis} onChange={(e) => setHypothesis(e.target.value)} placeholder="例: 便益訴求の見出しの方がCVRが高い" disabled={saving} />
      </div>
      <div className="ab-arm-forms">
        <ArmInputs arm="a" fields={armA} onChange={setArmA} disabled={saving} />
        <ArmInputs arm="b" fields={armB} onChange={setArmB} disabled={saving} />
      </div>
      <div>
        <button type="submit" className="btn pri" disabled={!canSave}>
          {saving ? '登録中…' : 'テストを登録して判定'}
        </button>
      </div>
    </form>
  );
}

/* ---- アーム比較 (勝者は緑枠で強調) ---- */
function ArmCompare({ test }: { test: AbTestDto }) {
  const { a, b, result } = test;
  const arms: Array<{ key: 'a' | 'b'; arm: AbTestDto['a'] }> = [
    { key: 'a', arm: a },
    { key: 'b', arm: b },
  ];
  return (
    <div className="ab-arms">
      {arms.map(({ key, arm }, i) => {
        const win = result.winner === key;
        return (
          <Fragment key={key}>
            {i === 1 ? <div className="ab-vs" aria-hidden="true">VS</div> : null}
            <div className={`ab-arm${win ? ' win' : ''}`}>
              <div className="ab-arm-top">
                <span className="ab-arm-key">{key.toUpperCase()}</span>
                <span className="ab-arm-label">{arm.label}</span>
                {win ? <span className="pill up">勝者</span> : null}
              </div>
              <div className="ab-arm-rate num">{formatPercent(arm.rate, 2)}</div>
              <div className="ab-arm-sub num">
                表示 {formatNumber(arm.impressions)} · クリック {formatNumber(arm.clicks)} · CV {formatNumber(arm.conversions)}
              </div>
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}

/* ---- 勝ちパターンに昇格するインラインフォーム (B-3→B-1) ---- */
function PromoteForm({ test, onDone }: { test: AbTestDto; onDone: () => void }) {
  const winnerLabel = test.result.winner === 'b' ? test.b.label : test.a.label;
  const [appealAxis, setAppealAxis] = useState(winnerLabel);
  const [creativeSummary, setCreativeSummary] = useState('');
  const [objective, setObjective] = useState<KnowledgeObjective>('conversion');
  const [shareAnonymized, setShareAnonymized] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const canSave = appealAxis.trim().length > 0 && !saving;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError(null);
    const body: PromoteAbTestInput = {
      abTestId: test.id,
      appealAxis: appealAxis.trim(),
      creativeSummary: creativeSummary.trim(),
      objective,
      shareAnonymized,
    };
    apiPost<KnowledgeAssetDto>('/knowledge/promote', body)
      .then(() => {
        setSaving(false);
        onDone();
      })
      .catch((err: unknown) => {
        setError(toApiError(err));
        setSaving(false);
      });
  };

  return (
    <form className="inline-form form-grid" style={{ marginTop: 10 }} onSubmit={submit}>
      {error ? <ErrorCard error={error} /> : null}
      <div className="field">
        <label htmlFor={`promote-axis-${test.id}`}>訴求軸</label>
        <input
          id={`promote-axis-${test.id}`}
          className="input"
          type="text"
          value={appealAxis}
          onChange={(e) => setAppealAxis(e.target.value)}
          placeholder="例: 便益訴求の見出し"
          disabled={saving}
        />
      </div>
      <div className="field">
        <label htmlFor={`promote-summary-${test.id}`}>クリエイティブ要約</label>
        <textarea
          id={`promote-summary-${test.id}`}
          className="textarea"
          value={creativeSummary}
          onChange={(e) => setCreativeSummary(e.target.value)}
          placeholder="例: 冒頭で価格メリットを提示し、CTAを『無料で試す』に変更"
          disabled={saving}
        />
      </div>
      <div className="field">
        <label htmlFor={`promote-objective-${test.id}`}>目的</label>
        <select
          id={`promote-objective-${test.id}`}
          className="select"
          value={objective}
          onChange={(e) => setObjective(e.target.value as KnowledgeObjective)}
          disabled={saving}
        >
          {OBJECTIVES.map((o) => (
            <option key={o} value={o}>{KNOWLEDGE_OBJECTIVE_LABEL[o]}</option>
          ))}
        </select>
      </div>
      <label className={`check-chip${shareAnonymized ? ' on' : ''}`} style={{ alignSelf: 'flex-start' }}>
        <input
          type="checkbox"
          checked={shareAnonymized}
          onChange={(e) => setShareAnonymized(e.target.checked)}
          disabled={saving}
        />
        匿名で共有ナレッジにも登録する
      </label>
      <p style={{ margin: 0, fontSize: 11.5, color: 'var(--muted)' }}>
        業種の他社事例として匿名・統計化して共有されます。クライアント名や実額は含まれません。
      </p>
      <div>
        <button type="submit" className="btn sm pri" disabled={!canSave}>
          {saving ? '登録中…' : '勝ちパターンに登録'}
        </button>
      </div>
    </form>
  );
}

/* ---- テストカード ---- */
function TestCard({ test, onChanged }: { test: AbTestDto; onChanged: () => void }) {
  const { result } = test;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [showPromote, setShowPromote] = useState(false);
  const [promoted, setPromoted] = useState(false);

  const summaryVariant = result.significant ? 'sig' : !result.enoughData ? 'amber' : 'flat';
  const lift = liftText(result.lift);
  const canConclude = test.status === 'running' && result.significant;
  const canPromote = result.winner === 'a' || result.winner === 'b';

  const conclude = () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    apiPost<AbTestDto>(`/abtests/${test.id}/conclude`, {})
      .then(() => {
        setBusy(false);
        onChanged();
      })
      .catch((err: unknown) => {
        setError(toApiError(err));
        setBusy(false);
      });
  };

  return (
    <div className="ab-card">
      <div className="ab-head">
        <span className="ab-name">{test.name}</span>
        <span className={`pill ${test.status === 'running' ? 'ai' : 'flat'}`}>
          {test.status === 'running' ? '実施中' : '終了'}
        </span>
        <span className="tag">{METRIC_LABEL[test.metric]}</span>
        <span className="ab-client">{test.clientName}</span>
      </div>
      {test.hypothesis ? <div className="ab-hyp">仮説: {test.hypothesis}</div> : null}

      <ArmCompare test={test} />

      <div className={`ab-summary ${summaryVariant}`}>
        <span className="f-label">判定</span>
        <p className="ab-summary-text">{result.summary}</p>
        <div className="ab-summary-meta num">
          {lift ? <span>リフト {lift}</span> : null}
          {result.pValue !== null ? <span>p値 {result.pValue.toFixed(3)}</span> : null}
        </div>
      </div>

      {error ? <ErrorCard error={error} /> : null}
      {canConclude || (canPromote && !promoted) ? (
        <div className="f-actions">
          {canConclude ? (
            <button type="button" className="btn sm pri" disabled={busy} onClick={conclude}>
              {busy ? '確定中…' : 'このテストを終了して勝者を確定'}
            </button>
          ) : null}
          {canPromote && !promoted ? (
            <button type="button" className="btn sm sec" onClick={() => setShowPromote((v) => !v)}>
              {showPromote ? '登録をやめる' : '勝ちパターンに登録'}
            </button>
          ) : null}
        </div>
      ) : null}

      {showPromote && !promoted ? (
        <PromoteForm
          test={test}
          onDone={() => {
            setShowPromote(false);
            setPromoted(true);
          }}
        />
      ) : null}

      {promoted ? (
        <div className="alert info" style={{ marginTop: 10, marginBottom: 0 }}>
          <span className="a-ico" aria-hidden="true">●</span>
          <div>
            <span className="a-title">勝ちパターンに登録しました</span>
            <br />
            <Link href="/knowledge" style={{ fontSize: 12.5 }}>勝ちパターンで確認する</Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function AbTestsPage() {
  const tests = useApi<AbTestDto[]>('/abtests');
  const list = tests.data ?? [];

  return (
    <>
      <div className="page-h">
        <h1>A/Bテスト</h1>
        <span className="sub">訴求・クリエイティブの勝敗を統計的に判定します</span>
      </div>

      <CreateForm onDone={tests.retry} />

      {tests.error ? <ErrorCard error={tests.error} onRetry={tests.retry} /> : null}

      {tests.loading ? (
        <div className="card">
          <div className="c-body"><SkeletonLines count={5} /></div>
        </div>
      ) : null}

      {tests.data && list.length === 0 ? (
        <EmptyState
          title="まだA/Bテストがありません"
          sub="A/Bテストを登録して、訴求・クリエイティブの勝敗を統計的に判定しましょう。"
        />
      ) : null}

      {list.length > 0 ? (
        <div className="ab-list">
          {list.map((t) => (
            <TestCard key={t.id} test={t} onChanged={tests.retry} />
          ))}
        </div>
      ) : null}
    </>
  );
}
