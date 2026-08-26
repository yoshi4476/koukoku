import type { Platform } from './platforms';

/**
 * UTM・命名規則ジェネレータ + 一貫性チェック (F-38)。
 * 媒体ごとに標準化した utm_source/medium と命名規則を自動生成し、貼られたURLの
 * 表記ゆれ(大文字/空白/非標準source等)を検知する。計測の分断を防ぐ。
 */

export const PLATFORM_UTM: Record<Platform, { source: string; medium: string }> = {
  google_ads: { source: 'google', medium: 'cpc' },
  yahoo_search: { source: 'yahoo', medium: 'cpc' },
  yahoo_display: { source: 'yahoo', medium: 'display' },
  meta: { source: 'facebook', medium: 'paid_social' },
  line_ads: { source: 'line', medium: 'paid_social' },
  tiktok: { source: 'tiktok', medium: 'paid_social' },
  x_ads: { source: 'twitter', medium: 'paid_social' },
  microsoft_ads: { source: 'bing', medium: 'cpc' },
  amazon_ads: { source: 'amazon', medium: 'cpc' },
  smartnews_ads: { source: 'smartnews', medium: 'display' },
  criteo: { source: 'criteo', medium: 'display' },
  pinterest: { source: 'pinterest', medium: 'paid_social' },
};

/** UTM/命名で使うトークンに正規化 (小文字・空白→ハイフン・英数と-_のみ) */
export function normalizeToken(s: string): string {
  return (s ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\-_]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** キャンペーン命名規則: client_project_platform_yyyymm (正規化済み) */
export function campaignName(clientName: string, projectName: string, platform: Platform, yyyymm: string): string {
  const parts = [clientName, projectName, PLATFORM_UTM[platform].source, yyyymm].map(normalizeToken).filter(Boolean);
  return parts.join('_');
}

/** 標準化した計測用URL (UTM付き) を生成 */
export function buildUtmUrl(baseUrl: string, platform: Platform, campaign: string, content?: string, term?: string): string {
  const u = PLATFORM_UTM[platform];
  const params: [string, string][] = [
    ['utm_source', u.source],
    ['utm_medium', u.medium],
    ['utm_campaign', normalizeToken(campaign)],
  ];
  if (content) params.push(['utm_content', normalizeToken(content)]);
  if (term) params.push(['utm_term', normalizeToken(term)]);
  const base = (baseUrl || 'https://example.com').trim();
  const sep = base.includes('?') ? '&' : '?';
  return base + sep + params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
}

export interface UtmCheckIssue {
  level: 'error' | 'warn';
  message: string;
}

/** 貼られた計測URLの表記ゆれ・欠落を検査する */
export function checkUtmConsistency(url: string): { ok: boolean; issues: UtmCheckIssue[] } {
  const issues: UtmCheckIssue[] = [];
  const raw = (url ?? '').trim();
  if (!raw) return { ok: false, issues: [{ level: 'error', message: 'URLが空です。' }] };

  // クエリだけを取り出す。フラグメント(#以降)は UTM ではないので落とす
  // (残すと "?utm_source=google#top" が source=google#top になり誤warn)
  const qs = (raw.split('?')[1] ?? '').split('#')[0];
  // 不正な%エンコード ("50%off" 等) で decodeURIComponent が例外を投げると
  // 検査関数ごとクラッシュするため、失敗時は生値を使う
  const dec = (s: string): string => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  };
  const params = new Map<string, string>();
  for (const pair of qs.split('&')) {
    if (!pair) continue;
    const [k, v = ''] = pair.split('=');
    params.set(k.toLowerCase(), dec(v));
  }
  for (const req of ['utm_source', 'utm_medium', 'utm_campaign']) {
    if (!params.has(req)) issues.push({ level: 'error', message: `${req} がありません。` });
  }
  const KNOWN_SOURCES = new Set(Object.values(PLATFORM_UTM).map((p) => p.source));
  const KNOWN_MEDIUMS = new Set(Object.values(PLATFORM_UTM).map((p) => p.medium));
  const src = params.get('utm_source');
  const med = params.get('utm_medium');
  for (const [key, val] of params) {
    if (!key.startsWith('utm_')) continue;
    if (val !== val.toLowerCase()) issues.push({ level: 'warn', message: `${key} に大文字が含まれます（「${val}」）。小文字で統一を。` });
    if (/\s/.test(val)) issues.push({ level: 'error', message: `${key} に空白が含まれます（「${val}」）。ハイフンに置換を。` });
  }
  if (src && !KNOWN_SOURCES.has(src)) issues.push({ level: 'warn', message: `utm_source「${src}」は標準表記と異なります（例: ${[...KNOWN_SOURCES].slice(0, 4).join(', ')}）。` });
  if (med && !KNOWN_MEDIUMS.has(med)) issues.push({ level: 'warn', message: `utm_medium「${med}」は標準表記と異なります（例: cpc / paid_social / display）。` });

  return { ok: !issues.some((i) => i.level === 'error'), issues };
}
