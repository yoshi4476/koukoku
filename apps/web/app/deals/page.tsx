'use client';

import { useState } from 'react';
import type { CreateDealInput, DealDto, DealStage, DealSummaryDto } from '@adgrid/shared';
import { DEAL_STAGES, DEAL_STAGE_LABEL } from '@adgrid/shared';
import { useApi } from '@/components/use-api';
import { useClients } from '@/components/client-context';
import { ErrorCard, HintBar, SkeletonLines } from '@/components/ui';
import { apiDelete, apiPost, apiPut, toApiError, type ApiError } from '@/lib/api';
import { formatNumber, formatYen } from '@/lib/format';

const STAGE_CLS: Record<DealStage, string> = { lead: 'flat', negotiation: 'ai', won: 'up', lost: 'down' };

function AddDeal({ clientId, onDone }: { clientId: string; onDone: () => void }) {
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [margin, setMargin] = useState('30');
  const [source, setSource] = useState('');
  const [stage, setStage] = useState<DealStage>('lead');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const submit = () => {
    if (!name.trim() || busy) return;
    setBusy(true); setError(null);
    const body: CreateDealInput = { clientId, name: name.trim(), stage, value: Number(value.replace(/,/g, '')) || 0, grossMarginPct: Number(margin) || 30, source: source.trim() };
    apiPost('/deals', body).then(() => { setName(''); setValue(''); setSource(''); onDone(); }).catch((e: unknown) => setError(toApiError(e))).finally(() => setBusy(false));
  };
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="c-head"><h2>案件を追加</h2></div>
      <div className="c-body">
        {error ? <ErrorCard error={error} /> : null}
        <div className="deal-form">
          <label className="kpit-field" style={{ flex: 2 }}><span>案件名</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="例: 株式会社サンプル 商談" /></label>
          <label className="kpit-field"><span>受注額(円)</span><input className="input" inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} placeholder="例: 300000" /></label>
          <label className="kpit-field"><span>粗利率(%)</span><input className="input" inputMode="numeric" value={margin} onChange={(e) => setMargin(e.target.value)} placeholder="30" /></label>
          <label className="kpit-field"><span>流入</span><input className="input" value={source} onChange={(e) => setSource(e.target.value)} placeholder="例: Google検索" /></label>
          <label className="kpit-field"><span>ステージ</span>
            <select className="select" value={stage} onChange={(e) => setStage(e.target.value as DealStage)}>
              {DEAL_STAGES.map((s) => <option key={s} value={s}>{DEAL_STAGE_LABEL[s]}</option>)}
            </select></label>
          <button className="btn pri" disabled={busy || !name.trim()} onClick={submit}>{busy ? '追加中…' : '追加'}</button>
        </div>
      </div>
    </div>
  );
}

export default function DealsPage() {
  const { selectedClientId, clients } = useClients();
  const cid = selectedClientId;
  const summary = useApi<DealSummaryDto>(cid ? `/deals/summary?clientId=${cid}` : null);
  const deals = useApi<DealDto[]>(cid ? `/deals?clientId=${cid}` : null);
  const refresh = () => { summary.refresh(); deals.refresh(); };

  const setStage = (id: string, stage: DealStage) => apiPut(`/deals/${id}`, { stage }).then(refresh);
  const del = (id: string) => apiDelete(`/deals/${id}`).then(refresh);
  const clientName = clients.find((c) => c.id === cid)?.name ?? '';

  return (
    <>
      <div className="page-h"><h1>💼 成約パイプライン</h1>{clientName ? <span className="sub">{clientName}</span> : null}</div>
      <HintBar id="deals" title="成約パイプラインの使い方">
        広告で獲得したCVを<mark>商談→受注（成約）</mark>まで追跡します。ラストクリックの数だけでなく、<b>実際の受注額・粗利ROAS</b>で広告の本当の価値が分かり、成約まで一気通貫で見えます。
      </HintBar>

      {!cid ? (
        <div className="card"><div className="c-body"><p style={{ margin: 0, color: 'var(--muted)' }}>上部の「クライアント」で対象を選ぶと、そのクライアントの成約状況が表示されます。</p></div></div>
      ) : (
        <>
          {summary.loading ? <div className="card"><div className="c-body"><SkeletonLines count={2} /></div></div> : null}
          {summary.error ? <ErrorCard error={summary.error} onRetry={summary.retry} /> : null}
          {summary.data ? (
            <div className="card" style={{ marginBottom: 14 }}>
              <div className="c-head"><h2>成果（広告 → 成約）</h2></div>
              <div className="c-body">
                <div className="deal-kpis">
                  <div className="dk"><span>成約率</span><b>{summary.data.winRate !== null ? `${summary.data.winRate}%` : '—'}</b><small>受注 {summary.data.wonCount}件</small></div>
                  <div className="dk"><span>受注額（合計）</span><b>{formatYen(summary.data.wonValue)}</b><small>平均 {formatYen(summary.data.avgWonValue)}</small></div>
                  <div className="dk hi"><span>粗利ROAS</span><b>{summary.data.grossRoas !== null ? `${summary.data.grossRoas}%` : '—'}</b><small>粗利 {formatYen(summary.data.grossProfit)}</small></div>
                  <div className="dk"><span>広告費（30日）</span><b>{formatYen(summary.data.adCost)}</b></div>
                  <div className="dk"><span>進行中の見込み額</span><b>{formatYen(summary.data.pipelineValue)}</b><small>見込+商談</small></div>
                </div>
              </div>
            </div>
          ) : null}

          <AddDeal clientId={cid} onDone={refresh} />

          <div className="card">
            <div className="c-head"><h2>案件一覧</h2>{deals.data ? <span className="sub" style={{ marginLeft: 'auto' }}>{deals.data.length}件</span> : null}</div>
            <div className="c-body tbl-scroll" style={{ padding: 0 }}>
              {deals.loading ? <div style={{ padding: 16 }}><SkeletonLines count={3} /></div> : deals.error ? <ErrorCard error={deals.error} onRetry={deals.retry} /> : (
                <table className="data-tbl">
                  <thead><tr><th>案件</th><th>流入</th><th>受注額</th><th>粗利率</th><th>ステージ</th><th></th></tr></thead>
                  <tbody>
                    {(deals.data ?? []).map((d) => (
                      <tr key={d.id}>
                        <td>{d.name}</td>
                        <td>{d.source || '—'}</td>
                        <td>{formatYen(d.value)}</td>
                        <td>{d.grossMarginPct}%</td>
                        <td>
                          <select className={`select deal-stage ${STAGE_CLS[d.stage]}`} value={d.stage} onChange={(e) => setStage(d.id, e.target.value as DealStage)}>
                            {DEAL_STAGES.map((s) => <option key={s} value={s}>{DEAL_STAGE_LABEL[s]}</option>)}
                          </select>
                        </td>
                        <td><button className="btn sm sec danger-text" onClick={() => del(d.id)}>削除</button></td>
                      </tr>
                    ))}
                    {deals.data && deals.data.length === 0 ? <tr><td colSpan={6} style={{ color: 'var(--muted)' }}>まだ案件がありません。上の「案件を追加」から登録しましょう。</td></tr> : null}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
