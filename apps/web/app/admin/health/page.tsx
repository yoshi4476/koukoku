'use client';

import type { PlatformHealthDto } from '@adgrid/shared';
import { useApi } from '@/components/use-api';
import { ErrorCard, SkeletonLines } from '@/components/ui';

export default function AdminHealthPage() {
  const h = useApi<PlatformHealthDto>('/platform/health');
  const d = h.data;

  return (
    <>
      <div className="page-h">
        <h1>システム状態</h1>
        <span className="sub">障害時にまずここを見ます。赤があれば全テナントに影響します</span>
      </div>

      {h.loading ? <div className="card"><div className="c-body"><SkeletonLines count={5} /></div></div> : null}
      {h.error ? <ErrorCard error={h.error} onRetry={h.retry} /> : null}

      {d ? (
        <>
          <div className="card section-gap">
            <div className="c-head"><h2>基盤</h2></div>
            <div className="c-body">
              <div className="adm-kpis">
                <div className={`adm-kpi${d.rlsEnforced ? '' : ' bad'}`}>
                  <span>テナント分離 (RLS)</span>
                  <b className="num">{d.rlsEnforced ? '有効' : '無効'}</b>
                  <small>{d.rlsEnforced ? '他テナントのデータに到達できません' : '至急対応が必要です'}</small>
                </div>
                <div className="adm-kpi">
                  <span>DBロール</span><b className="num sm">{d.dbRole}</b>
                  <small>所有者ロールだとRLSを迂回します</small>
                </div>
                <div className={`adm-kpi${d.schedulerEnabled ? '' : ' warn'}`}>
                  <span>定期実行</span><b className="num">{d.schedulerEnabled ? '有効' : '停止'}</b>
                  <small>同期・週次レポート・アラート</small>
                </div>
                <div className="adm-kpi">
                  <span>実行環境</span><b className="num sm">{d.nodeEnv}</b>
                  <small>production 以外は開発設定です</small>
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="c-head">
              <h2>外部連携</h2>
              <span className="pill flat" style={{ marginLeft: 'auto' }}>
                {d.items.filter((i) => i.ok).length} / {d.items.length} 設定済み
              </span>
            </div>
            <div className="c-body">
              <div className="adm-health">
                {d.items.map((i) => (
                  <div key={i.key} className={`adm-hitem${i.ok ? ' ok' : i.optional ? ' opt' : ' ng'}`}>
                    <span className="adm-hmark">{i.ok ? '●' : '○'}</span>
                    <div>
                      <b>{i.label}</b>
                      {!i.ok && !i.optional ? <span className="pill down" style={{ marginLeft: 8 }}>要設定</span> : null}
                      {!i.ok && i.optional ? <span className="pill warn" style={{ marginLeft: 8 }}>任意</span> : null}
                      <small>{i.detail}</small>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}
