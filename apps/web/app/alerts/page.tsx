'use client';

import { useEffect, useState } from 'react';
import type {
  AlertEventDto,
  AlertMetric,
  AlertRuleDto,
  AlertRunResultDto,
  AlertSettingsDto,
} from '@adgrid/shared';
import { useApi } from '@/components/use-api';
import { ErrorCard, HintBar, PlatformTag, SkeletonLines } from '@/components/ui';
import { apiPatch, apiPost, apiPut, ApiError, toApiError } from '@/lib/api';
import { ALERT_METRIC_META } from '@/lib/labels';
import { formatDateTime } from '@/lib/format';

const METRIC_ORDER: AlertMetric[] = ['budget_pace', 'cpa_spike', 'cv_zero', 'spend_drop'];

/* ---- カード1: 検知ルール ---- */
function RulesCard({
  running,
  runResult,
  runError,
  onRun,
}: {
  running: boolean;
  runResult: AlertRunResultDto | null;
  runError: ApiError | null;
  onRun: () => void;
}) {
  const rulesApi = useApi<AlertRuleDto[]>('/alerts/rules');
  const [rules, setRules] = useState<AlertRuleDto[] | null>(null);
  /* しきい値inputの編集中テキスト (rule.id -> 入力値) */
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<ApiError | null>(null);

  useEffect(() => {
    if (rulesApi.data) {
      setRules(rulesApi.data);
      setDrafts({});
    }
  }, [rulesApi.data]);

  const saveRule = (
    id: string,
    patch: Partial<Pick<AlertRuleDto, 'threshold' | 'enabled' | 'channels'>>,
  ) => {
    if (savingId !== null) return;
    setSavingId(id);
    setSaveError(null);
    apiPatch<AlertRuleDto[]>(`/alerts/rules/${id}`, patch)
      .then((list) => {
        setRules(list);
        setDrafts((d) => {
          const next = { ...d };
          delete next[id];
          return next;
        });
        setSavingId(null);
      })
      .catch((e: unknown) => {
        setSaveError(toApiError(e));
        setSavingId(null);
        // サーバ状態と食い違わないよう再取得して同期する
        rulesApi.retry();
      });
  };

  const commitThreshold = (rule: AlertRuleDto) => {
    const raw = drafts[rule.id];
    if (raw === undefined) return;
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
      // 数値・正数以外は保存せず元の値へ戻す
      setDrafts((d) => {
        const next = { ...d };
        delete next[rule.id];
        return next;
      });
      return;
    }
    if (value === rule.threshold) {
      setDrafts((d) => {
        const next = { ...d };
        delete next[rule.id];
        return next;
      });
      return;
    }
    saveRule(rule.id, { threshold: value });
  };

  const sorted = rules
    ? [...rules].sort((a, b) => METRIC_ORDER.indexOf(a.metric) - METRIC_ORDER.indexOf(b.metric))
    : null;

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="c-head">
        <h2>検知ルール</h2>
        <span style={{ marginLeft: 'auto' }}>
          <button type="button" className="btn sm pri" onClick={onRun} disabled={running}>
            {running ? '検知中…' : '今すぐ検知を実行'}
          </button>
        </span>
      </div>
      {rulesApi.loading ? (
        <div className="c-body"><SkeletonLines count={4} /></div>
      ) : rulesApi.error ? (
        <div className="c-body"><ErrorCard error={rulesApi.error} onRetry={rulesApi.retry} /></div>
      ) : sorted ? (
        <>
          {runError || runResult || saveError ? (
            <div className="c-body" style={{ paddingBottom: 0 }}>
              {runError ? <ErrorCard error={runError} onRetry={onRun} /> : null}
              {runResult ? (
                <div className="alert info">
                  <span className="a-ico" aria-hidden="true">●</span>
                  <div>
                    <span className="a-title num">
                      検知 {runResult.fired}件 / 抑制 {runResult.suppressed}件 / 通知 {runResult.notified}件
                    </span>
                  </div>
                </div>
              ) : null}
              {saveError ? <ErrorCard error={saveError} /> : null}
            </div>
          ) : null}
          <div className="c-body tbl-scroll" style={{ padding: 0 }}>
            <table className="data-tbl rules-tbl">
              <thead>
                <tr>
                  <th>ルール</th>
                  <th>しきい値</th>
                  <th>通知先</th>
                  <th>有効</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((rule) => {
                  const meta = ALERT_METRIC_META[rule.metric];
                  const slackOn = rule.channels.includes('slack');
                  const saving = savingId === rule.id;
                  const locked = savingId !== null;
                  return (
                    <tr key={rule.id} className={saving ? 'saving' : undefined}>
                      <td>
                        <div className="rule-name">{meta.label}</div>
                        <div className="rule-desc">{meta.description}</div>
                      </td>
                      <td>
                        <span className="rule-thresh">
                          <input
                            type="number"
                            className="input"
                            min={1}
                            step="any"
                            value={drafts[rule.id] ?? String(rule.threshold)}
                            disabled={locked}
                            aria-label={`${meta.label}のしきい値`}
                            onChange={(e) =>
                              setDrafts((d) => ({ ...d, [rule.id]: e.target.value }))
                            }
                            onBlur={() => commitThreshold(rule)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') e.currentTarget.blur();
                            }}
                          />
                          <span className="rule-unit">{meta.unit}</span>
                        </span>
                      </td>
                      <td>
                        <span className="check-group">
                          <span className="tag">アプリ内 (常時)</span>
                          <label className={`check-chip${slackOn ? ' on' : ''}`}>
                            <input
                              type="checkbox"
                              checked={slackOn}
                              disabled={locked}
                              onChange={(e) =>
                                saveRule(rule.id, {
                                  channels: e.target.checked ? ['inapp', 'slack'] : ['inapp'],
                                })
                              }
                            />
                            Slack
                          </label>
                        </span>
                      </td>
                      <td>
                        <label className="switch" title={rule.enabled ? '無効にする' : '有効にする'}>
                          <input
                            type="checkbox"
                            checked={rule.enabled}
                            disabled={locked}
                            aria-label={`${meta.label}を有効にする`}
                            onChange={(e) => saveRule(rule.id, { enabled: e.target.checked })}
                          />
                          <span className="sw-track" aria-hidden="true" />
                          <span className="sw-knob" aria-hidden="true" />
                        </label>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  );
}

/* ---- カード2: Slack通知 ---- */
function SlackCard() {
  const settings = useApi<AlertSettingsDto>('/alerts/settings');
  const [url, setUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<ApiError | null>(null);
  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState(false);
  const [testError, setTestError] = useState<ApiError | null>(null);

  useEffect(() => {
    if (settings.data) setUrl(settings.data.slackWebhookUrl);
  }, [settings.data]);

  const save = () => {
    if (saving) return;
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    setTestError(null);
    apiPut<AlertSettingsDto>('/alerts/settings', { slackWebhookUrl: url.trim() })
      .then((d) => {
        setUrl(d.slackWebhookUrl);
        setSaved(true);
        setSaving(false);
      })
      .catch((e: unknown) => {
        setSaveError(toApiError(e));
        setSaving(false);
      });
  };

  const test = () => {
    if (testing) return;
    setTesting(true);
    setTested(false);
    setTestError(null);
    apiPost<{ ok: true }>('/alerts/settings/test', {})
      .then(() => {
        setTested(true);
        setTesting(false);
      })
      .catch((e: unknown) => {
        setTestError(toApiError(e));
        setTesting(false);
      });
  };

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="c-head"><h2>Slack通知</h2></div>
      {settings.loading ? (
        <div className="c-body"><SkeletonLines count={2} /></div>
      ) : settings.error ? (
        <div className="c-body"><ErrorCard error={settings.error} onRetry={settings.retry} /></div>
      ) : (
        <div className="c-body form-grid">
          {saveError ? <ErrorCard error={saveError} onRetry={save} /> : null}
          {testError ? <ErrorCard error={testError} onRetry={test} /> : null}
          {tested ? (
            <div className="alert info" style={{ marginBottom: 0 }}>
              <span className="a-ico" aria-hidden="true">●</span>
              <div><span className="a-title">テスト通知を送信しました</span></div>
            </div>
          ) : null}
          <div className="field">
            <label htmlFor="slack-webhook-url">Webhook URL</label>
            <input
              id="slack-webhook-url"
              type="url"
              className="input"
              placeholder="https://hooks.slack.com/services/..."
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setSaved(false);
              }}
            />
          </div>
          <div className="row-actions">
            <button type="button" className="btn pri" onClick={save} disabled={saving}>
              {saving ? '保存中…' : '保存'}
            </button>
            <button type="button" className="btn sec" onClick={test} disabled={testing}>
              {testing ? '送信中…' : 'テスト送信'}
            </button>
            {saved ? <span style={{ fontSize: 12, color: 'var(--good)', fontWeight: 600 }}>保存しました</span> : null}
          </div>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)' }}>
            Slackの Incoming Webhook を作成してURLを貼り付けてください。LINE通知はMessaging API対応として提供予定です。
          </p>
        </div>
      )}
    </div>
  );
}

/* ---- カード3: 発生履歴 ---- */
function EventRow({
  event,
  acking,
  onAck,
}: {
  event: AlertEventDto;
  acking: boolean;
  onAck: (id: string) => void;
}) {
  return (
    <div className={`alert-ev${event.acked ? ' acked' : ''}`}>
      <span className={`sev-ico ${event.severity}`} aria-hidden="true">
        {event.severity === 'bad' ? '●' : '▲'}
      </span>
      <span className="ev-time">{formatDateTime(event.firedAt)}</span>
      <span className="ev-title" title={event.body}>{event.title}</span>
      <span className="ev-meta">
        <span className="tag">{event.clientName}</span>
        <PlatformTag platform={event.platform} />
        {event.notified ? <span className="pill ai">Slack通知済</span> : null}
        {event.acked ? (
          <span className="pill flat">確認済</span>
        ) : (
          <button
            type="button"
            className="btn sm sec"
            onClick={() => onAck(event.id)}
            disabled={acking}
          >
            {acking ? '更新中…' : '確認済にする'}
          </button>
        )}
      </span>
    </div>
  );
}

function EventsCard({
  events,
  running,
  onRun,
}: {
  events: ReturnType<typeof useApi<AlertEventDto[]>>;
  running: boolean;
  onRun: () => void;
}) {
  const [ackingId, setAckingId] = useState<string | null>(null);
  const [ackError, setAckError] = useState<ApiError | null>(null);

  const ack = (id: string) => {
    if (ackingId !== null) return;
    setAckingId(id);
    setAckError(null);
    apiPost<{ ok: true }>(`/alerts/events/${id}/ack`, {})
      .then(() => {
        setAckingId(null);
        events.retry();
      })
      .catch((e: unknown) => {
        setAckError(toApiError(e));
        setAckingId(null);
      });
  };

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="c-head">
        <h2>発生履歴</h2>
        {events.data && events.data.length > 0 ? (
          <span className="pill flat num">{events.data.length}件</span>
        ) : null}
      </div>
      {events.loading ? (
        <div className="c-body"><SkeletonLines count={5} /></div>
      ) : events.error ? (
        <div className="c-body"><ErrorCard error={events.error} onRetry={events.retry} /></div>
      ) : events.data ? (
        events.data.length === 0 ? (
          <div className="c-body">
            <div className="empty">
              <div className="e-title">アラートはまだ発生していません</div>
              <div className="e-sub">検知を実行すると、しきい値を超えた項目がここに並びます。</div>
              <button type="button" className="btn pri" onClick={onRun} disabled={running}>
                {running ? '検知中…' : '今すぐ検知を実行'}
              </button>
            </div>
          </div>
        ) : (
          <>
            {ackError ? (
              <div className="c-body" style={{ paddingBottom: 0 }}>
                <ErrorCard error={ackError} />
              </div>
            ) : null}
            <div className="c-body" style={{ padding: 0 }}>
              {events.data.map((ev) => (
                <EventRow key={ev.id} event={ev} acking={ackingId === ev.id} onAck={ack} />
              ))}
            </div>
          </>
        )
      ) : null}
    </div>
  );
}

export default function AlertsPage() {
  const events = useApi<AlertEventDto[]>('/alerts/events?limit=50');
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<AlertRunResultDto | null>(null);
  const [runError, setRunError] = useState<ApiError | null>(null);

  const runNow = () => {
    if (running) return;
    setRunning(true);
    setRunResult(null);
    setRunError(null);
    apiPost<AlertRunResultDto>('/alerts/run', {})
      .then((r) => {
        setRunResult(r);
        setRunning(false);
        events.retry();
      })
      .catch((e: unknown) => {
        setRunError(toApiError(e));
        setRunning(false);
      });
  };

  return (
    <>
      <div className="page-h">
        <h1>アラート</h1>
        <span className="sub">予算・CPA・計測の異常を毎時検知して通知します</span>
      </div>

      <HintBar id="alerts" title="アラートの使い方">
        予算超過・CPA急変・計測ゼロ・消化急減を<mark>毎時自動で検知</mark>します。しきい値は自由に調整可能。<mark>Slack通知</mark>も設定できます。同じアラートは6時間抑制されるので通知が煩くなりません。
      </HintBar>
      <RulesCard running={running} runResult={runResult} runError={runError} onRun={runNow} />
      <SlackCard />
      <EventsCard events={events} running={running} onRun={runNow} />
    </>
  );
}
