import { describe, it } from 'vitest';
import {
  computeLift,
  recommendMediaPlan,
  buildKpiTree,
  checkUtmConsistency,
  parseInstruction,
  safeNegatives,
  buildKeywordPlan,
  buildPacingProposal,
  buildLaunchSheet,
  computeDealSummary,
  twoProportionPValue,
} from '@adgrid/shared';
import type { PacingDto } from '@adgrid/shared';

const log = (...a: any[]) => console.log(...a.map((x) => (typeof x === 'object' ? JSON.stringify(x) : x)));

describe('probe', () => {
  it('lift boundaries', () => {
    // control-only: ea>0 but exposedConversions huge vs control higher cvr
    log('lift control-wins', computeLift({ exposedAudience: 1000, exposedConversions: 10, exposedCost: 50000, controlAudience: 1000, controlConversions: 30 }));
    // ea=0 but conversions>0 (inconsistent) -> does it still emit incrementalCpa?
    log('lift ea0', computeLift({ exposedAudience: 0, exposedConversions: 5, exposedCost: 10000, controlAudience: 1000, controlConversions: 10 }));
    // 100% cvr both -> se=0 -> pValue null
    log('lift 100pct', computeLift({ exposedAudience: 100, exposedConversions: 100, exposedCost: 1000, controlAudience: 100, controlConversions: 100 }));
    // control cvr 0 -> liftPct null but incremental=ec
    log('lift ctrl0', computeLift({ exposedAudience: 1000, exposedConversions: 50, exposedCost: 100000, controlAudience: 1000, controlConversions: 0 }));
  });

  it('media plan tiny budgets & ties', () => {
    for (const b of [0, 1, 3, 7, 99, 100, 333]) {
      const p = recommendMediaPlan('ec', 'conversion', b);
      const shareSum = p.media.reduce((s, m) => s + m.sharePct, 0);
      const budSum = p.media.reduce((s, m) => s + m.monthlyBudget, 0);
      log('mediaplan', b, 'shareSum', shareSum, 'budSum', budSum, 'budgets', p.media.map((m) => m.monthlyBudget), 'negBudget', p.media.some((m) => m.monthlyBudget < 0));
    }
  });

  it('kpi rounding chain', () => {
    log('kpi', buildKpiTree({ industryCode: 'finance', targetCv: 1 }));
    log('kpi cvr0-custom', buildKpiTree({ industryCode: 'ec', targetCv: 100, cvr: 0, ctr: -5 }));
  });

  it('utm plus-encoding & dup', () => {
    log('utm plus', checkUtmConsistency('https://x.jp?utm_source=google&utm_medium=cpc&utm_campaign=spring+sale'));
    log('utm dup', checkUtmConsistency('https://x.jp?utm_source=google&utm_source=FACEBOOK&utm_medium=cpc&utm_campaign=x'));
    log('utm empty src', checkUtmConsistency('https://x.jp?utm_source=&utm_medium=cpc&utm_campaign=x'));
  });

  it('parseInstruction tricky', () => {
    for (const s of [
      '予算100万円 CPA2万円',
      'CPA 1.2万 予算 8万円',
      '月200,000円で運用',
      '1000件を目標',
      '30代女性向け 40-49歳',
      'CPA10000 CV500件 予算300万',
    ]) log('parse', s, parseInstruction(s));
  });

  it('safeNegatives substring traps', () => {
    log('sn1', safeNegatives(['求人', '中古'], ['中古車 買取 依頼'])); // 中古 should drop
    log('sn2', safeNegatives(['独学', 'とは'], ['英会話 独学 サポート'])); // 独学 drop, とは stay
  });

  it('pacing edge', () => {
    const base: PacingDto = { adAccountId: 'a', accountName: 'n', clientName: 'c', platform: 'google' as any, monthlyBudget: 300000, monthToDateCost: 150000, projectedMonthEnd: 300000, projectedPct: 100, recommendedDailyBudget: 10000, currentDailyAvg: 10000, status: 'on_track', runOutDate: null, daysLeft: 15 };
    // status over but projected < budget (inconsistent) -> direction decrease vs title over
    log('pacing inconsistent', buildPacingProposal({ ...base, projectedPct: 116, projectedMonthEnd: 250000, status: 'over' }));
  });

  it('dealsummary rounding', () => {
    log('deal', computeDealSummary([{ id: '1', clientId: 'c', projectId: null, name: 'd', stage: 'won', value: 99999, grossMarginPct: 33, source: '', note: '', createdAt: '', closedAt: null }], 7));
  });

  it('twoprop extreme', () => {
    log('tp both0conv', twoProportionPValue(0, 100, 0, 100));
    log('tp negative counts clamp? raw', twoProportionPValue(-5, 100, 5, 100));
  });
});
