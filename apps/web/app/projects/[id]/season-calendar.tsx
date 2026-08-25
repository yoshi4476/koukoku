'use client';

import { useMemo } from 'react';
import { SEASON_EVENTS, industryProfileFor } from '@adgrid/shared';

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const WEIGHT_LABEL: Record<number, string> = { 1: '小', 2: '中', 3: '大' };

/** ISO日付から月(1-12)を取り出す。不正値は null */
function monthOf(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const m = Number(iso.slice(5, 7));
  return m >= 1 && m <= 12 ? m : null;
}

/**
 * 販促カレンダー (F-53)。プロジェクトの配信期間と日本の需要期を重ねて表示し、
 * 「いつ強めるか」を配信設定の中で判断できるようにする。
 */
export function SeasonCalendar({ industryCode, startDate, endDate }: {
  industryCode: string;
  startDate?: string | null;
  endDate?: string | null;
}) {
  const profile = industryProfileFor(industryCode);
  const now = new Date();
  const thisMonth = now.getUTCMonth() + 1;
  const s = monthOf(startDate);
  const e = monthOf(endDate);

  const inPeriod = (m: number) => {
    if (s === null && e === null) return true; // 期間未設定は通年扱い
    if (s !== null && e !== null) return s <= e ? m >= s && m <= e : m >= s || m <= e; // 年跨ぎ対応
    if (s !== null) return m >= s;
    return m <= (e as number);
  };

  const byMonth = useMemo(() => {
    const map = new Map<number, typeof SEASON_EVENTS>();
    for (const m of MONTHS) map.set(m, SEASON_EVENTS.filter((ev) => ev.month === m));
    return map;
  }, []);

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="c-head"><h2>📅 販促カレンダー</h2></div>
      <div className="c-body">
        <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.75 }}>
          日本の<mark>需要期</mark>とこのプロジェクトの配信期間を重ねています。需要が大きい月に予算を寄せると、同じ広告費でも成果が伸びます。
          {startDate || endDate ? null : <> 配信期間が未設定のため、通年として表示しています。</>}
        </p>
        <div className="seasoncal">
          {MONTHS.map((m) => {
            const evs = byMonth.get(m) ?? [];
            const peak = evs.reduce((a, b) => Math.max(a, b.weight), 0);
            const on = inPeriod(m);
            return (
              <div key={m} className={`sc-month${on ? ' on' : ''}${m === thisMonth ? ' now' : ''}`}>
                <div className="sc-m-h">
                  <span className="sc-m-n">{m}月</span>
                  {m === thisMonth ? <span className="sc-now">今月</span> : null}
                  {peak > 0 ? <span className={`sc-peak w${peak}`}>需要{WEIGHT_LABEL[peak]}</span> : null}
                </div>
                {evs.length === 0
                  ? <div className="sc-ev muted">目立つ需要期なし</div>
                  : evs.map((ev, i) => (
                    <div className="sc-ev" key={i}>
                      <b>{ev.name}</b>
                      <span>{ev.note}</span>
                    </div>
                  ))}
                {!on ? <div className="sc-off">配信期間外</div> : null}
              </div>
            );
          })}
        </div>
        <p className="sc-note">
          <b>{profile.label}</b>の勘所: {profile.appealAxes.slice(0, 3).join(' / ')} — 需要期にはこの訴求を前面に出すと効きます。
        </p>
      </div>
    </div>
  );
}
