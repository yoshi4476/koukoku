'use client';

import { useEffect, useState, type FormEvent } from 'react';
import type {
  DashboardDef,
  DashboardListDto,
  WidgetDataDto,
  WidgetDef,
  WidgetDimension,
  WidgetMetric,
  WidgetType,
} from '@adgrid/shared';
import { WIDGET_METRIC_LABEL } from '@adgrid/shared';
import { useApi } from '@/components/use-api';
import { useClients } from '@/components/client-context';
import { DeltaPill, EmptyState, ErrorCard, HintBar, Skeleton, SkeletonLines } from '@/components/ui';
import { apiDelete, apiPost, apiPut, ApiError, toApiError } from '@/lib/api';
import { WIDGET_DIMENSION_LABEL, WIDGET_TYPE_LABEL } from '@/lib/labels';
import { formatNumber, formatPercent, formatYen } from '@/lib/format';

const TYPES: WidgetType[] = ['stat', 'bar', 'line', 'table'];
const METRICS: WidgetMetric[] = ['cost', 'conversions', 'cpa', 'roas', 'clicks', 'impressions', 'ctr', 'cvr'];
const DIMENSIONS: WidgetDimension[] = ['none', 'platform', 'client', 'date'];
const WIDTHS: Array<{ v: 1 | 2 | 3; label: string }> = [
  { v: 1, label: '1/3幅' },
  { v: 2, label: '2/3幅' },
  { v: 3, label: '全幅' },
];
const DAY_OPTIONS = [7, 14, 30, 90];

/** 低いほど良い指標 (前期比の色を反転する) */
const LOWER_IS_BETTER = new Set<WidgetMetric>(['cpa']);

function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `w_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** metricのunitで表示を整形する (yen→¥ / count→件 / percent→% / ratio→そのまま) */
function formatWidgetValue(value: number | null, unit: WidgetDataDto['unit']): string {
  if (value === null) return '—';
  switch (unit) {
    case 'yen':
      return formatYen(value);
    case 'percent':
      return formatPercent(value);
    case 'count':
      return `${formatNumber(value)}件`;
    case 'ratio':
    default:
      return value.toLocaleString('ja-JP', { maximumFractionDigits: 2 });
  }
}

/* ---- stat: 大きな数値 + 前期比ピル ---- */
function StatWidget({ metric, dto }: { metric: WidgetMetric; dto: WidgetDataDto }) {
  const stat = dto.stat ?? { value: 0, delta: null };
  return (
    <div className="wstat">
      <div className="wstat-val num">{formatWidgetValue(stat.value, dto.unit)}</div>
      <DeltaPill value={stat.delta} invert={LOWER_IS_BETTER.has(metric)} />
    </div>
  );
}

/* ---- bar: 横棒グラフ (値降順・最大値を100%) ---- */
function BarWidget({ dto }: { dto: WidgetDataDto }) {
  const series = [...(dto.series ?? [])].sort((a, b) => b.value - a.value);
  if (series.length === 0) return <p className="wnote">表示できるデータがありません。</p>;
  const max = Math.max(...series.map((s) => s.value), 1);
  return (
    <div className="wbar-list">
      {series.map((s, i) => (
        <div className="wbar-row" key={`${s.label}-${i}`}>
          <div className="wbar-label" title={s.label}>{s.label}</div>
          <div className="wbar-track">
            <div className="wbar-fill" style={{ width: `${Math.max((s.value / max) * 100, 0)}%` }} />
          </div>
          <div className="wbar-val num">{formatWidgetValue(s.value, dto.unit)}</div>
        </div>
      ))}
    </div>
  );
}

/* ---- line: SVG折れ線 (trend-chart.tsx の手法を参考) ---- */
function LineWidget({ dto }: { dto: WidgetDataDto }) {
  const series = dto.series ?? [];
  const n = series.length;
  if (n < 2) return <p className="wnote">折れ線を描くにはデータが2点以上必要です。</p>;

  const W = 320;
  const H = 128;
  const PL = 6;
  const PR = 6;
  const PT = 14;
  const PB = 8;
  const vals = series.map((s) => s.value);
  const maxV = Math.max(...vals, 0);
  const minV = Math.min(...vals, 0);
  const range = maxV - minV || 1;
  const x = (i: number) => PL + ((W - PL - PR) * i) / (n - 1);
  const y = (v: number) => PT + (H - PT - PB) * (1 - (v - minV) / range);

  const line = series.map((s, i) => `${x(i)},${y(s.value)}`).join(' ');
  let area = `M${x(0)},${y(series[0]!.value)}`;
  series.forEach((s, i) => {
    area += ` L${x(i)},${y(s.value)}`;
  });
  area += ` L${x(n - 1)},${y(minV)} L${x(0)},${y(minV)} Z`;

  const last = series[n - 1]!;
  const first = series[0]!;
  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        role="img"
        aria-label={`${last.label}時点で${formatWidgetValue(last.value, dto.unit)}`}
      >
        <path d={area} fill="var(--primary)" opacity={0.08} />
        <polyline
          points={line}
          fill="none"
          stroke="var(--primary)"
          strokeWidth={2.4}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx={x(n - 1)} cy={y(last.value)} r={3.5} fill="var(--primary)" />
        <text x={x(n - 1) - 6} y={y(last.value) - 8} textAnchor="end" fontSize={11} fontWeight={700} fill="var(--ink)">
          {formatWidgetValue(last.value, dto.unit)}
        </text>
      </svg>
      <div className="wline-labels">
        <span>{first.label}</span>
        <span>{last.label}</span>
      </div>
    </div>
  );
}

/* ---- table: ラベル / 値 の2列テーブル ---- */
function TableWidget({ widget, dto }: { widget: WidgetDef; dto: WidgetDataDto }) {
  const series = dto.series ?? [];
  if (series.length === 0) return <p className="wnote">表示できるデータがありません。</p>;
  const labelHead = widget.dimension === 'none' ? '項目' : WIDGET_DIMENSION_LABEL[widget.dimension];
  return (
    <div className="tbl-scroll">
      <table className="data-tbl">
        <thead>
          <tr>
            <th>{labelHead}</th>
            <th>{WIDGET_METRIC_LABEL[widget.metric]}</th>
          </tr>
        </thead>
        <tbody>
          {series.map((s, i) => (
            <tr key={`${s.label}-${i}`}>
              <td>{s.label}</td>
              <td>{formatWidgetValue(s.value, dto.unit)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function WidgetBody({ widget, dto }: { widget: WidgetDef; dto: WidgetDataDto | undefined }) {
  if (!dto) return <p className="wnote">データを取得できませんでした。</p>;
  switch (widget.type) {
    case 'stat':
      return <StatWidget metric={widget.metric} dto={dto} />;
    case 'bar':
      return <BarWidget dto={dto} />;
    case 'line':
      return <LineWidget dto={dto} />;
    case 'table':
      return <TableWidget widget={widget} dto={dto} />;
    default:
      return null;
  }
}

/* ---- ウィジェットカード (編集モードで並べ替え・削除) ---- */
function WidgetCard({
  widget,
  dto,
  editMode,
  saving,
  isFirst,
  isLast,
  onMove,
  onDelete,
}: {
  widget: WidgetDef;
  dto: WidgetDataDto | undefined;
  editMode: boolean;
  saving: boolean;
  isFirst: boolean;
  isLast: boolean;
  onMove: (dir: -1 | 1) => void;
  onDelete: () => void;
}) {
  return (
    <div className="wcard" style={{ gridColumn: `span ${widget.width}` }}>
      <div className="wcard-head">
        <span className="wcard-title" title={widget.title}>{widget.title}</span>
        {editMode ? (
          <div className="wcard-tools">
            <button type="button" className="wcard-tool" title="前へ移動" aria-label="前へ移動" disabled={saving || isFirst} onClick={() => onMove(-1)}>←</button>
            <button type="button" className="wcard-tool" title="後へ移動" aria-label="後へ移動" disabled={saving || isLast} onClick={() => onMove(1)}>→</button>
            <button type="button" className="wcard-tool del" title="削除" aria-label="削除" disabled={saving} onClick={onDelete}>×</button>
          </div>
        ) : null}
      </div>
      <div className="wcard-body">
        <WidgetBody widget={widget} dto={dto} />
      </div>
    </div>
  );
}

/* ---- ウィジェット追加フォーム ---- */
function AddWidgetForm({ onAdd, saving }: { onAdd: (w: WidgetDef) => void; saving: boolean }) {
  const { clients, selectedClientId } = useClients();
  const [title, setTitle] = useState('');
  const [type, setType] = useState<WidgetType>('stat');
  const [metric, setMetric] = useState<WidgetMetric>('cost');
  const [dimension, setDimension] = useState<WidgetDimension>('none');
  const [width, setWidth] = useState<1 | 2 | 3>(1);
  const [days, setDays] = useState(30);
  const [clientId, setClientId] = useState(selectedClientId);

  const canAdd = title.trim().length > 0 && !saving;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!canAdd) return;
    onAdd({
      id: newId(),
      type,
      title: title.trim(),
      metric,
      dimension,
      width,
      days,
      ...(clientId ? { clientId } : {}),
    });
    setTitle('');
  };

  const statHint = type === 'stat' && dimension !== 'none';
  const lineHint = type === 'line' && dimension !== 'date';

  return (
    <form className="inline-form form-grid" style={{ marginTop: 16 }} onSubmit={submit}>
      <div className="row-actions">
        <div className="field" style={{ flex: '1 1 220px' }}>
          <label htmlFor="wa-title">タイトル</label>
          <input
            id="wa-title"
            className="input"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例: 消化額の推移"
            disabled={saving}
            style={{ width: '100%' }}
          />
        </div>
        <div className="field">
          <label htmlFor="wa-type">種別</label>
          <select id="wa-type" className="select" value={type} onChange={(e) => setType(e.target.value as WidgetType)} disabled={saving}>
            {TYPES.map((t) => (
              <option key={t} value={t}>{WIDGET_TYPE_LABEL[t]}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="wa-metric">指標</label>
          <select id="wa-metric" className="select" value={metric} onChange={(e) => setMetric(e.target.value as WidgetMetric)} disabled={saving}>
            {METRICS.map((m) => (
              <option key={m} value={m}>{WIDGET_METRIC_LABEL[m]}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="wa-dimension">集計軸</label>
          <select id="wa-dimension" className="select" value={dimension} onChange={(e) => setDimension(e.target.value as WidgetDimension)} disabled={saving}>
            {DIMENSIONS.map((d) => (
              <option key={d} value={d}>{WIDGET_DIMENSION_LABEL[d]}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="wa-width">幅</label>
          <select id="wa-width" className="select" value={width} onChange={(e) => setWidth(Number(e.target.value) as 1 | 2 | 3)} disabled={saving}>
            {WIDTHS.map((w) => (
              <option key={w.v} value={w.v}>{w.label}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="wa-days">期間</label>
          <select id="wa-days" className="select" value={days} onChange={(e) => setDays(Number(e.target.value))} disabled={saving}>
            {DAY_OPTIONS.map((d) => (
              <option key={d} value={d}>{d}日</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="wa-client">クライアント絞り</label>
          <select id="wa-client" className="select" value={clientId} onChange={(e) => setClientId(e.target.value)} disabled={saving}>
            <option value="">すべて</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      </div>
      {statHint ? <p className="wnote">数値は「集計なし」が見やすくおすすめです。</p> : null}
      {lineHint ? <p className="wnote">折れ線は「日別」を選ぶと推移が見やすくなります。</p> : null}
      <div>
        <button type="submit" className="btn pri" disabled={!canAdd}>
          {saving ? '追加中…' : 'ウィジェットを追加'}
        </button>
      </div>
    </form>
  );
}

function BoardGridSkeleton() {
  return (
    <div className="wgrid">
      {Array.from({ length: 3 }, (_, i) => (
        <div className="wcard" key={i}>
          <div className="wcard-head"><Skeleton w="50%" h={13} /></div>
          <div className="wcard-body"><SkeletonLines count={3} /></div>
        </div>
      ))}
    </div>
  );
}

export default function BoardsPage() {
  const list = useApi<DashboardListDto>('/dashboards');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [nameDraft, setNameDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<ApiError | null>(null);

  const dashboards = list.data?.dashboards ?? [];

  // 一覧取得後、未選択または選択が消えた場合は先頭を選ぶ
  useEffect(() => {
    const ds = list.data?.dashboards;
    if (!ds) return;
    if (ds.length === 0) {
      setSelectedId(null);
      return;
    }
    setSelectedId((cur) => (cur && ds.some((d) => d.id === cur) ? cur : ds[0]!.id));
  }, [list.data]);

  const def = useApi<DashboardDef>(selectedId ? `/dashboards/${selectedId}` : null);
  const data = useApi<WidgetDataDto[]>(selectedId ? `/dashboards/${selectedId}/data` : null);

  useEffect(() => {
    if (def.data) setNameDraft(def.data.name);
  }, [def.data]);

  const layout = def.data?.layout ?? [];
  const selected = dashboards.find((d) => d.id === selectedId) ?? null;

  const refresh = () => {
    def.retry();
    data.retry();
    list.retry();
  };

  const saveLayout = async (nextLayout: WidgetDef[], name?: string) => {
    if (!selectedId) return;
    setSaving(true);
    setSaveError(null);
    try {
      await apiPut<DashboardDef>(
        `/dashboards/${selectedId}`,
        name !== undefined ? { name, layout: nextLayout } : { layout: nextLayout },
      );
      refresh();
    } catch (e) {
      setSaveError(toApiError(e));
    } finally {
      setSaving(false);
    }
  };

  const addWidget = (w: WidgetDef) => {
    void saveLayout([...layout, w]);
    setShowAdd(false);
  };

  const removeWidget = (id: string) => {
    void saveLayout(layout.filter((w) => w.id !== id));
  };

  const moveWidget = (id: string, dir: -1 | 1) => {
    const idx = layout.findIndex((w) => w.id === id);
    const j = idx + dir;
    if (idx < 0 || j < 0 || j >= layout.length) return;
    const next = [...layout];
    const tmp = next[idx]!;
    next[idx] = next[j]!;
    next[j] = tmp;
    void saveLayout(next);
  };

  const renameBoard = () => {
    const name = nameDraft.trim();
    if (!name || name === def.data?.name) return;
    void saveLayout(layout, name);
  };

  const createBoard = async () => {
    const name = newName.trim();
    if (!name) return;
    setSaving(true);
    setSaveError(null);
    try {
      const created = await apiPost<DashboardDef>('/dashboards', { name });
      setNewName('');
      setCreating(false);
      setSelectedId(created.id);
      list.retry();
    } catch (e) {
      setSaveError(toApiError(e));
    } finally {
      setSaving(false);
    }
  };

  const deleteBoard = async () => {
    if (!selectedId) return;
    if (!window.confirm('このダッシュボードを削除しますか？元に戻せません。')) return;
    setSaving(true);
    setSaveError(null);
    try {
      await apiDelete(`/dashboards/${selectedId}`);
      setSelectedId(null);
      list.retry();
    } catch (e) {
      setSaveError(toApiError(e));
    } finally {
      setSaving(false);
    }
  };

  const dataById = new Map((data.data ?? []).map((d) => [d.widgetId, d]));
  const ready = def.data !== null && data.data !== null;
  const boardLoading = selectedId !== null && (def.loading || data.loading);

  return (
    <>
      <div className="page-h">
        <h1>カスタムボード</h1>
        <span className="sub">指標・グラフを自由に並べた自分だけのダッシュボード</span>
        {saving ? <span className="sub">保存中…</span> : null}
      </div>

      <HintBar id="boards" title="カスタムボードの使い方">
        指標・グラフを自由に並べた<mark>自分だけのダッシュボード</mark>を作れます。「編集」を押すとウィジェットの追加・並べ替え・削除ができます。数値・横棒・折れ線・表の4種類。クライアント報告用のビューを保存しておくと便利です。
      </HintBar>

      {list.error ? <ErrorCard error={list.error} onRetry={list.retry} /> : null}
      {list.loading ? (
        <div className="card"><div className="c-body"><SkeletonLines count={2} /></div></div>
      ) : null}

      {list.data ? (
        <div className="boards-bar">
          {dashboards.length > 0 ? (
            <div className="tabs" role="tablist" aria-label="ダッシュボードを切り替える">
              {dashboards.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  role="tab"
                  className={`tab${d.id === selectedId ? ' on' : ''}`}
                  aria-selected={d.id === selectedId}
                  onClick={() => setSelectedId(d.id)}
                >
                  {d.name}
                  <span className="wtab-count">{d.widgetCount}</span>
                </button>
              ))}
            </div>
          ) : null}
          <button type="button" className="btn sm sec" onClick={() => setCreating((v) => !v)} disabled={saving}>
            {creating ? '追加をやめる' : '＋ 新規ダッシュボード'}
          </button>
          {selectedId ? (
            <div className="spacer">
              <button
                type="button"
                className={`btn sm ${editMode ? 'pri' : 'sec'}`}
                onClick={() => {
                  setEditMode((v) => !v);
                  setShowAdd(false);
                }}
              >
                {editMode ? '編集を終了' : '編集'}
              </button>
              {editMode && selected && !selected.isDefault ? (
                <button type="button" className="btn sm sec" onClick={deleteBoard} disabled={saving}>
                  削除
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {creating ? (
        <form
          className="inline-form"
          style={{ marginBottom: 16, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}
          onSubmit={(e) => {
            e.preventDefault();
            void createBoard();
          }}
        >
          <div className="field" style={{ flex: '1 1 240px' }}>
            <label htmlFor="board-new-name">ダッシュボード名</label>
            <input
              id="board-new-name"
              className="input"
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="例: 週次モニタリング"
              disabled={saving}
              style={{ width: '100%' }}
            />
          </div>
          <button type="submit" className="btn pri" disabled={saving || newName.trim().length === 0}>
            作成
          </button>
        </form>
      ) : null}

      {saveError ? <ErrorCard error={saveError} /> : null}

      {editMode && selectedId && def.data ? (
        <div className="board-rename">
          <div className="field" style={{ flex: '1 1 240px' }}>
            <label htmlFor="board-rename">ダッシュボード名</label>
            <input
              id="board-rename"
              className="input"
              type="text"
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              disabled={saving}
              style={{ width: '100%' }}
            />
          </div>
          <button
            type="button"
            className="btn sm sec"
            onClick={renameBoard}
            disabled={saving || nameDraft.trim().length === 0 || nameDraft.trim() === def.data.name}
          >
            名前を保存
          </button>
        </div>
      ) : null}

      {list.data && dashboards.length === 0 ? (
        <EmptyState
          title="ダッシュボードがまだありません"
          sub="新規ダッシュボードを作成して、自分だけの分析画面を組み立てましょう。"
          action={
            <button type="button" className="btn pri" onClick={() => setCreating(true)}>
              ＋ 新規ダッシュボード
            </button>
          }
        />
      ) : null}

      {def.error ? <ErrorCard error={def.error} onRetry={refresh} /> : null}
      {data.error && !def.error ? <ErrorCard error={data.error} onRetry={refresh} /> : null}

      {boardLoading ? <BoardGridSkeleton /> : null}

      {selectedId && ready && !def.error && !data.error ? (
        layout.length === 0 ? (
          <EmptyState
            title="ウィジェットがまだありません"
            sub="ウィジェットを追加して、自分だけのダッシュボードを作りましょう。"
            action={
              !editMode ? (
                <button type="button" className="btn pri" onClick={() => { setEditMode(true); setShowAdd(true); }}>
                  編集モードにする
                </button>
              ) : null
            }
          />
        ) : (
          <div className="wgrid">
            {layout.map((w, i) => (
              <WidgetCard
                key={w.id}
                widget={w}
                dto={dataById.get(w.id)}
                editMode={editMode}
                saving={saving}
                isFirst={i === 0}
                isLast={i === layout.length - 1}
                onMove={(dir) => moveWidget(w.id, dir)}
                onDelete={() => removeWidget(w.id)}
              />
            ))}
          </div>
        )
      ) : null}

      {editMode && selectedId && ready ? (
        showAdd ? (
          <AddWidgetForm onAdd={addWidget} saving={saving} />
        ) : (
          <button type="button" className="btn sec wadd-btn" onClick={() => setShowAdd(true)} disabled={saving}>
            ＋ ウィジェットを追加
          </button>
        )
      ) : null}
    </>
  );
}
