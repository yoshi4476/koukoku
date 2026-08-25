'use client';

import { useState, type FormEvent } from 'react';
import type { AbTestDto, LiftTestDto } from '@adgrid/shared';
import { useApi } from '@/components/use-api';
import { ErrorCard, SkeletonLines } from '@/components/ui';
import { apiPost, toApiError, type ApiError } from '@/lib/api';
import { formatNumber, formatPercent, formatYen } from '@/lib/format';

/* ---------------- A/Bテスト ---------------- */
function AbTestPanel({ clientId }: { clientId: string }) {
  const tests = useApi<AbTestDto[]>(`/abtests?clientId=${encodeURIComponent(clientId)}`);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const items = tests.data ?? [];

  const create = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const num = (k: string) => Number(f.get(k) ?? 0) || 0;
    setBusy(true); setError(null);
    apiPost('/abtests', {
      clientId,
      name: String(f.get('name') ?? '').trim(),
      hypothesis: String(f.get('hypothesis') ?? '').trim(),
      metric: String(f.get('metric') ?? 'cvr'),
      a: { label: String(f.get('aLabel') ?? 'A案'), impressions: num('aImpr'), clicks: num('aClicks'), conversions: num('aConv') },
      b: { label: String(f.get('bLabel') ?? 'B案'), impressions: num('bImpr'), clicks: num('bClicks'), conversions: num('bConv') },
    })
      .then(() => { setOpen(false); tests.retry(); })
      .catch((err: unknown) => setError(toApiError(err)))
      .finally(() => setBusy(false));
  };

  const conclude = (id: string) => {
    apiPost(`/abtests/${id}/conclude`, {}).then(() => tests.retry()).catch(() => undefined);
  };

  if (tests.loading) return <SkeletonLines count={3} />;
  if (tests.error) return <ErrorCard error={tests.error} onRetry={tests.retry} />;

  return (
    <>
      <div className="deliver-row" style={{ marginBottom: 12 }}>
        <button type="button" className="btn sm pri" onClick={() => setOpen((v) => !v)}>{open ? '閉じる' : '＋ テストを登録'}</button>
        <span className="deliver-hint">2案の実績を入れると、勝ち負けを統計的に判定します（当てずっぽうを防げます）</span>
      </div>
      {error ? <ErrorCard error={error} /> : null}

      {open ? (
        <form className="ab-form" onSubmit={create}>
          <div className="set-row">
            <div className="field"><label>テスト名</label><input className="input" name="name" required placeholder="例: 見出しA/Bテスト" /></div>
            <div className="field"><label>判定指標</label>
              <select className="select" name="metric" defaultValue="cvr"><option value="cvr">CVR（成約率）</option><option value="ctr">CTR（クリック率）</option></select>
            </div>
          </div>
          <div className="field"><label>仮説</label><input className="input" name="hypothesis" placeholder="例: 数字を入れた見出しの方がCVRが高い" /></div>
          {(['a', 'b'] as const).map((arm) => (
            <div className="set-row" key={arm}>
              <div className="field"><label>{arm.toUpperCase()}案の名前</label><input className="input" name={`${arm}Label`} defaultValue={`${arm.toUpperCase()}案`} /></div>
              <div className="field"><label>表示回数</label><input className="input" name={`${arm}Impr`} type="number" min="0" defaultValue="0" /></div>
              <div className="field"><label>クリック</label><input className="input" name={`${arm}Clicks`} type="number" min="0" defaultValue="0" /></div>
              <div className="field"><label>CV</label><input className="input" name={`${arm}Conv`} type="number" min="0" defaultValue="0" /></div>
            </div>
          ))}
          <div className="f-actions"><button className="btn pri" disabled={busy}>{busy ? '登録中…' : 'テストを登録して判定'}</button></div>
        </form>
      ) : null}

      {items.length === 0 ? <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13 }}>まだテストがありません。</p> : (
        <div className="ab-list">
          {items.map((t) => (
            <div className="ab-item" key={t.id}>
              <div className="ab-head">
                <span className="ab-name">{t.name}</span>
                <span className={`pill ${t.status === 'concluded' ? 'flat' : 'ai'}`}>{t.status === 'concluded' ? '確定済' : '実施中'}</span>
                {t.result.significant
                  ? <span className="pill up">有意差あり（{t.result.winner === 'a' ? 'A' : 'B'}の勝ち）</span>
                  : <span className="pill warn">{t.result.enoughData ? '有意差なし' : 'データ不足'}</span>}
                {t.status !== 'concluded'
                  ? <button type="button" className="btn sm sec" style={{ marginLeft: 'auto' }} onClick={() => conclude(t.id)}>確定する</button> : null}
              </div>
              <div className="ab-arms">
                {([t.a, t.b] as const).map((arm, i) => (
                  <div className={`ab-arm${t.result.winner === (i === 0 ? 'a' : 'b') && t.result.significant ? ' win' : ''}`} key={i}>
                    <div className="ab-arm-l">{arm.label}</div>
                    <div className="ab-arm-v num">{arm.rate === null ? '—' : formatPercent(arm.rate, 2)}</div>
                    <div className="ab-arm-s num">{formatNumber(arm.impressions)}imp / {formatNumber(arm.clicks)}cl / {formatNumber(arm.conversions)}cv</div>
                  </div>
                ))}
              </div>
              <p className="ab-sum">{t.result.summary}</p>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/* ---------------- 増分効果テスト ---------------- */
function LiftPanel({ clientId }: { clientId: string }) {
  const all = useApi<LiftTestDto[]>('/lift-tests');
  const items = (all.data ?? []).filter((t) => !t.clientId || t.clientId === clientId);
  if (all.loading) return <SkeletonLines count={3} />;
  if (all.error) return <ErrorCard error={all.error} onRetry={all.retry} />;
  if (items.length === 0) {
    return (
      <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13, lineHeight: 1.8 }}>
        まだ増分効果テストがありません。<br />
        <b>増分効果テスト</b>は「広告を見せなかった group」と比較して、<mark>広告が本当に生んだCV</mark>を測る手法です。
        「広告を止めても売れていたのでは？」に答えられます。
      </p>
    );
  }
  return (
    <div className="lift-list">
      {items.map((t) => (
        <div className="lift-item" key={t.id}>
          <div className="ab-head">
            <span className="ab-name">{t.name}</span>
            <span className="pill flat">{t.method}</span>
            <span className={`pill ${t.status === 'done' ? 'up' : 'ai'}`}>{t.status}</span>
          </div>
          {t.result ? (
            <div className="reall-summary">
              <div><div className="rs-l">増分CV</div><div className="rs-v up">+{formatNumber(t.result.incrementalConversions)}<span className="rs-u">件</span></div></div>
              <div><div className="rs-l">増分CPA</div><div className="rs-v">{t.result.incrementalCpa === null ? '—' : formatYen(t.result.incrementalCpa)}</div></div>
              <div><div className="rs-l">リフト</div><div className="rs-v">{t.result.liftPct === null ? '—' : formatPercent(t.result.liftPct, 1)}</div></div>
            </div>
          ) : <p style={{ margin: 0, fontSize: 12.5, color: 'var(--muted)' }}>結果の入力待ちです。</p>}
        </div>
      ))}
    </div>
  );
}

/** A/Bテストと増分効果テストを改善タブに統合 (F-53) */
export function ExperimentTools({ clientId }: { clientId: string }) {
  return (
    <>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="c-head"><h2>🧪 A/Bテスト</h2></div>
        <div className="c-body"><AbTestPanel clientId={clientId} /></div>
      </div>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="c-head"><h2>📊 増分効果テスト</h2></div>
        <div className="c-body"><LiftPanel clientId={clientId} /></div>
      </div>
    </>
  );
}
