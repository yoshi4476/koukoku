const WEEKDAY_FMT = new Intl.DateTimeFormat('ja-JP', { weekday: 'short' });
const TIME_FMT = new Intl.DateTimeFormat('ja-JP', { hour: '2-digit', minute: '2-digit', hour12: false });
const NUM_FMT = new Intl.NumberFormat('ja-JP');

function toDate(input: string | Date): Date | null {
  const d = typeof input === 'string' ? new Date(input) : input;
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 「8/21(金)」形式 */
export function formatDate(input: string | Date): string {
  const d = toDate(input);
  if (!d) return '—';
  return `${d.getMonth() + 1}/${d.getDate()}(${WEEKDAY_FMT.format(d)})`;
}

/** 「8/21(金) 06:00」形式 */
export function formatDateTime(input: string | Date | null): string {
  if (input === null) return '—';
  const d = toDate(input);
  if (!d) return '—';
  return `${formatDate(d)} ${TIME_FMT.format(d)}`;
}

/** 「8/15(土)〜8/21(金)」形式 */
export function formatPeriod(since: string, until: string): string {
  return `${formatDate(since)}〜${formatDate(until)}`;
}

export function formatNumber(n: number | null): string {
  return n === null ? '—' : NUM_FMT.format(Math.round(n));
}

export function formatYen(n: number | null): string {
  return n === null ? '—' : `¥${NUM_FMT.format(Math.round(n))}`;
}

/** 率 (%値をそのまま受け取る)。null は「—」 */
export function formatPercent(n: number | null, digits = 1): string {
  return n === null ? '—' : `${n.toFixed(digits)}%`;
}

/** 軸ラベル用の短縮表記 (例: 214000 → 21.4万) */
export function formatCompactYen(n: number): string {
  if (Math.abs(n) >= 10000) {
    const man = n / 10000;
    return `${Number.isInteger(man) ? man : man.toFixed(1)}万`;
  }
  return NUM_FMT.format(Math.round(n));
}
