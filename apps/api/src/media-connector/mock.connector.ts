import type { Platform } from '@adgrid/shared';
import {
  ApplyResult,
  AuthorizeResult,
  BaseConnector,
  ChangeRequest,
  DateRange,
  ExternalAccount,
  NormalizedRow,
} from './core';

/** 文字列から決定的な 0..1 乱数 (同期の洗い替えで毎回同じ値になるように) */
function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

function eachDate(range: DateRange): string[] {
  const out: string[] = [];
  const d = new Date(range.since + 'T00:00:00Z');
  const end = new Date(range.until + 'T00:00:00Z');
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/**
 * デモ接続コネクタ: 実API認証なしで接続フロー・同期・洗い替えを検証するための
 * 決定的な擬似データ生成。実コネクタと同一インターフェースで差し替え可能。
 */
export class MockConnector extends BaseConnector {
  constructor(readonly platform: Platform) {
    super();
  }

  async authorize(tenantId: string): Promise<AuthorizeResult> {
    return { mode: 'mock', candidates: await this.fetchAccounts(tenantId) };
  }

  /** デモ接続: 媒体への書込をシミュレートして成功を返す (承認フローの検証用) */
  protected async doApplyChange(change: ChangeRequest): Promise<ApplyResult> {
    return {
      success: true,
      simulated: true,
      note: `デモ接続のため媒体への適用をシミュレートしました (${change.operation}: ${change.externalId})。実API接続後は本適用されます。`,
    };
  }

  async fetchAccounts(tenantId: string): Promise<ExternalAccount[]> {
    const base = hash01(`${tenantId}:${this.platform}`);
    const id1 = String(Math.floor(base * 900000000) + 100000000);
    const id2 = String(Math.floor(base * 800000000) + 200000000);
    return [
      { externalAccountId: id1, name: `デモアカウント (メイン)` },
      { externalAccountId: id2, name: `デモアカウント (サブ)` },
    ];
  }

  async fetchReport(externalAccountId: string, range: DateRange): Promise<NormalizedRow[]> {
    const campaigns = [
      { id: 'cmp-main', name: 'メインキャンペーン', baseCost: 12000, ctr: 0.03, cvr: 0.025, aov: 10000 },
      { id: 'cmp-test', name: 'テスト配信', baseCost: 5000, ctr: 0.012, cvr: 0.012, aov: 10000 },
    ];
    const rows: NormalizedRow[] = [];
    const today = new Date().toISOString().slice(0, 10);
    for (const date of eachDate(range)) {
      const dow = new Date(date + 'T00:00:00Z').getUTCDay();
      const weekend = dow === 0 || dow === 6 ? 0.8 : 1.0;
      // 直近7日はCVRを落とし、AI診断が検出できる悪化パターンを含める
      const daysAgo =
        (new Date(today + 'T00:00:00Z').getTime() - new Date(date + 'T00:00:00Z').getTime()) /
        86400000;
      for (const c of campaigns) {
        const jitter = 0.85 + hash01(`${externalAccountId}:${c.id}:${date}`) * 0.3;
        const cost = Math.round(c.baseCost * weekend * jitter);
        const cpc = 70 + hash01(`${externalAccountId}:${c.id}:${date}:cpc`) * 60;
        const clicks = Math.max(1, Math.round(cost / cpc));
        const cvr = c.id === 'cmp-main' && daysAgo < 7 ? c.cvr * 0.6 : c.cvr;
        const conversions = +(clicks * cvr).toFixed(1);
        rows.push({
          date,
          campaignId: c.id,
          campaignName: c.name,
          impressions: Math.round(clicks / c.ctr),
          clicks,
          cost,
          conversions,
          conversionValue: Math.round(conversions * c.aov),
        });
      }
    }
    return rows;
  }
}
