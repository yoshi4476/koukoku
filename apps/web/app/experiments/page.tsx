'use client';

import { useState } from 'react';
import type { CreateLiftTestInput, LiftMethod, LiftTestDto } from '@adgrid/shared';
import { LIFT_METHOD_LABEL } from '@adgrid/shared';
import { useApi } from '@/components/use-api';
import { ErrorCard, HintBar, SkeletonLines } from '@/components/ui';
import { apiDelete, apiPost, apiPut, toApiError, type ApiError } from '@/lib/api';
import { formatNumber, formatYen } from '@/lib/format';

const METHODS: LiftMethod[] = ['holdback', 'geo', 'audience'];
const STATUS_LABEL: Record<string, string> = { planning: '計画中', running: '実施中', done: '完了' };

function numOrNull(v: string): number | null {
  const n = Number(v.replace(/,/g, ''));
  return v.trim() === '' || Number.isNaN(n) ? null : n;
}

function CreateForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('');
  const [method, setMethod] = useState<LiftMethod>('holdback');
  const [holdoutPct, setHoldoutPct] = useState('10');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const submit = () => {
    if (!name.trim() || busy) return;
    setBusy(true); setError(null);
    const body: CreateLiftTestInput = { name: name.trim(), method, holdoutPct: Number(holdoutPct) || 10 };
    apiPost('/lift-tests', body).then(() => { setName(''); onDone(); }).catch((e: unknown) => setError(toApiError(e))).finally(() => setBusy(false));
  };

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="c-head"><h2>増分効果テストを設計</h2></div>
      <div className="c-body form-grid">
        {error ? <ErrorCard error={error} /> : null}
        <div className="lift-form">
          <label className="kpit-field" style={{ flex: 2 }}><span>テスト名</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="例: 春商戦 リターゲ増分テスト" /></label>
          <label className="kpit-field"><span>手法</span>
            <select className="select" value={method} onChange={(e) => setMethod(e.target.value as LiftMethod)}>
              {METHODS.map((m) => <option key={m} value={m}>{LIFT_METHOD_LABEL[m]}</option>)}
            </select></label>
          <label className="kpit-field"><span>ホールドアウト率(%)</span>
            <input className="input" inputMode="numeric" value={holdoutPct} onChange={(e) => setHoldoutPct(e.target.value)} placeholder="10" /></label>
          <button className="btn pri" disabled={busy || !name.trim()} onClick={submit}>{busy ? '作成中…' : 'テストを作成'}</button>
        </div>
      </div>
    </div>
  );
}

function TestCard({ t, onChanged }: { t: LiftTestDto; onChanged: () => void }) {
  const [ea, setEa] = useState(t.exposedAudience?.toString() ?? '');
  const [ec, setEc] = useState(t.exposedConversions?.toString() ?? '');
  const [ecost, setEcost] = useState(t.exposedCost?.toString() ?? '');
  const [ca, setCa] = useState(t.controlAudience?.toString() ?? '');
  const [cc, setCc] = useState(t.controlConversions?.toString() ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const r = t.result;

  const save = (patch: Record<string, unknown>) => {
    setBusy(true); setError(null);
    apiPut(`/lift-tests/${t.id}`, patch).then(() => onChanged()).catch((e: unknown) => setError(toApiError(e))).finally(() => setBusy(false));
  };
  const saveResults = () => save({
    exposedAudience: numOrNull(ea), exposedConversions: numOrNull(ec), exposedCost: numOrNull(ecost),
    controlAudience: numOrNull(ca), controlConversions: numOrNull(cc), status: 'done',
  });
  const remove = () => { setBusy(true); apiDelete(`/lift-tests/${t.id}`).then(() => onChanged()).catch((e: unknown) => { setError(toApiError(e)); setBusy(false); }); };

  return (
    <div className="card lift-card">
      <div className="c-head">
        <h2>{t.name}</h2>
        <span className="pill flat" style={{ marginLeft: 8 }}>{LIFT_METHOD_LABEL[t.method]}</span>
        <span className={`pill ${t.status === 'done' ? 'up' : t.status === 'running' ? 'ai' : 'flat'}`}>{STATUS_LABEL[t.status]}</span>
        <button className="btn sm sec danger-text" style={{ marginLeft: 'auto' }} disabled={busy} onClick={remove}>削除</button>
      </div>
      <div className="c-body">
        {error ? <ErrorCard error={error} /> : null}
        <p className="lift-guide">ホールドアウト {t.holdoutPct}%（対照群に広告を出さず、露出群と比べて広告が生んだ増分を測ります）。計測結果を入力してください。</p>
        <div className="lift-grid">
          <div className="lift-col">
            <div className="lift-col-h">露出群（広告あり）</div>
            <label className="kpit-field"><span>規模（人/IMP）</span><input className="input" inputMode="numeric" value={ea} onChange={(e) => setEa(e.target.value)} /></label>
            <label className="kpit-field"><span>CV数</span><input className="input" inputMode="numeric" value={ec} onChange={(e) => setEc(e.target.value)} /></label>
            <label className="kpit-field"><span>広告費（円）</span><input className="input" inputMode="numeric" value={ecost} onChange={(e) => setEcost(e.target.value)} /></label>
          </div>
          <div className="lift-col">
            <div className="lift-col-h">対照群（広告なし・ホールドアウト）</div>
            <label className="kpit-field"><span>規模（人/IMP）</span><input className="input" inputMode="numeric" value={ca} onChange={(e) => setCa(e.target.value)} /></label>
            <label className="kpit-field"><span>CV数</span><input className="input" inputMode="numeric" value={cc} onChange={(e) => setCc(e.target.value)} /></label>
            <button className="btn sm pri" disabled={busy} onClick={saveResults} style={{ marginTop: 'auto' }}>結果を保存して算出</button>
          </div>
        </div>

        {r ? (
          <div className={`lift-result ${r.significant ? 'sig' : ''}`}>
            <div className="lift-res-grid">
              <div className="lr"><span>露出CVR</span><b>{r.exposedCvr}%</b></div>
              <div className="lr"><span>対照CVR</span><b>{r.controlCvr}%</b></div>
              <div className="lr hi"><span>増分CV</span><b>{formatNumber(r.incrementalConversions)}</b></div>
              <div className="lr hi"><span>増分CPA（真の獲得効率）</span><b>{formatYen(r.incrementalCpa)}</b></div>
              <div className="lr"><span>リフト率</span><b>{r.liftPct !== null ? `${r.liftPct}%` : '—'}</b></div>
              <div className="lr"><span>有意性</span><b className={r.significant ? 'sig-yes' : 'sig-no'}>{r.significant ? `有意 (p=${r.pValue})` : `未確定 (p=${r.pValue ?? '—'})`}</b></div>
            </div>
            <p className="lift-note">{r.note}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function ExperimentsPage() {
  const { data, loading, error, retry, refresh } = useApi<LiftTestDto[]>('/lift-tests');
  return (
    <>
      <div className="page-h"><h1>🧪 増分効果テスト</h1></div>
      <HintBar id="experiments" title="増分効果テストの使い方">
        広告を<mark>見せない対照群（ホールドアウト）</mark>と比べ、広告が<mark>本当に生んだCV（増分）</mark>を測ります。ラストクリックのCPAではなく<b>増分CPA</b>が実際の獲得効率です。予算判断の根拠になります。
      </HintBar>

      <CreateForm onDone={refresh} />

      {loading ? <div className="card"><div className="c-body"><SkeletonLines count={4} /></div></div> : null}
      {error ? <ErrorCard error={error} onRetry={retry} /> : null}
      {data && data.length === 0 ? <div className="card"><div className="c-body"><p style={{ margin: 0, color: 'var(--muted)' }}>まだテストがありません。上のフォームから設計しましょう。</p></div></div> : null}
      {data?.map((t) => <TestCard key={t.id} t={t} onChanged={refresh} />)}
    </>
  );
}
