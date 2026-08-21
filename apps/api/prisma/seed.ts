/* eslint-disable no-console */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

// 管理者ロールで実行 (RLSは所有者にはかからないため seed 可能)
const prisma = new PrismaClient();

const TENANT_ID = 't_demo_agency';

// ローカル暦日をUTC深夜に固定 (@db.Date のUTC切り捨てとの整合。apiの日付規約と同一)
function daysAgo(n: number): Date {
  const now = new Date();
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

/** 曜日で揺らぎをつける決定的な擬似乱数 (再現性のため Math.random 不使用) */
function wave(dayIndex: number, salt: number): number {
  const x = Math.sin(dayIndex * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x); // 0..1
}

interface CampaignSpec {
  campaignId: string;
  campaignName: string;
  baseCost: number; // 日次基準費用
  baseCvr: number; // クリック→CVのCVR
  baseCtr: number; // Imp→クリックのCTR
  avgOrderValue: number;
  /** 直近7日のCV係数 (悪化・改善パターンの再現) */
  recentConvFactor?: number;
  /** 計測欠落の再現: CVを常にゼロにする */
  zeroConversions?: boolean;
}

async function seedFacts(
  adAccountId: string,
  platform: string,
  campaigns: CampaignSpec[],
) {
  const rows = [];
  for (let day = 27; day >= 0; day--) {
    const date = daysAgo(day);
    const dow = date.getDay();
    const weekendFactor = dow === 0 || dow === 6 ? 0.78 : 1.0;
    for (const c of campaigns) {
      const jitter = 0.85 + wave(day, c.baseCost) * 0.3;
      const cost = Math.round(c.baseCost * weekendFactor * jitter);
      const cpc = 80 + wave(day, 2) * 60;
      const clicks = Math.max(1, Math.round(cost / cpc));
      const impressions = Math.round(clicks / c.baseCtr);
      let cvr = c.baseCvr;
      if (day < 7 && c.recentConvFactor !== undefined) cvr *= c.recentConvFactor;
      let conversions = c.zeroConversions ? 0 : +(clicks * cvr).toFixed(1);
      const conversionValue = Math.round(conversions * c.avgOrderValue);
      rows.push({
        date,
        tenantId: TENANT_ID,
        adAccountId,
        platform,
        campaignId: c.campaignId,
        campaignName: c.campaignName,
        adgroupId: '',
        adId: '',
        impressions: BigInt(impressions),
        clicks: BigInt(clicks),
        cost,
        conversions,
        conversionValue,
        currency: 'JPY',
        extra: {},
      });
    }
  }
  await prisma.factAdPerformance.createMany({ data: rows });
}

async function main() {
  console.log('Seeding ADGRID demo data...');
  // 子テーブルから順に削除 (FK制約対応)
  await prisma.dashboard.deleteMany({});
  await prisma.changeLog.deleteMany({});
  await prisma.knowledgeAsset.deleteMany({});
  await prisma.calibrationStat.deleteMany({});
  await prisma.proposal.deleteMany({});
  await prisma.abTest.deleteMany({});
  await prisma.alertEvent.deleteMany({});
  await prisma.alertRule.deleteMany({});
  await prisma.auditTrail.deleteMany({});
  await prisma.factAdPerformance.deleteMany({});
  await prisma.audit.deleteMany({});
  await prisma.report.deleteMany({});
  await prisma.copyJob.deleteMany({});
  await prisma.csvImport.deleteMany({});
  await prisma.llmCall.deleteMany({});
  await prisma.mediaConnection.deleteMany({});
  await prisma.adAccount.deleteMany({});
  await prisma.client.deleteMany({});
  await prisma.tenantMember.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.tenant.deleteMany({});

  await prisma.tenant.create({
    data: { id: TENANT_ID, name: 'デモ広告代理店', plan: 'business' },
  });

  // デモログイン: demo@adgrid.jp / demo-pass-2026
  const demoUser = await prisma.user.create({
    data: {
      email: 'demo@adgrid.jp',
      passwordHash: await bcrypt.hash('demo-pass-2026', 10),
      name: 'デモ 運用者',
    },
  });
  await prisma.tenantMember.create({
    data: { userId: demoUser.id, tenantId: TENANT_ID, role: 'owner' },
  });

  const clientA = await prisma.client.create({
    data: { id: 'c_a', tenantId: TENANT_ID, name: 'クライアントA (EC・物販)', industryCode: 'ec' },
  });
  const clientB = await prisma.client.create({
    data: { id: 'c_b', tenantId: TENANT_ID, name: 'クライアントB (美容・コスメ)', industryCode: 'beauty' },
  });
  const clientC = await prisma.client.create({
    data: { id: 'c_c', tenantId: TENANT_ID, name: 'クライアントC (BtoB SaaS)', industryCode: 'saas' },
  });

  const accAGoogle = await prisma.adAccount.create({
    data: {
      id: 'acc_a_google', tenantId: TENANT_ID, clientId: clientA.id,
      platform: 'google_ads', externalAccountId: '123-456-7890',
      name: 'A社 Google広告', monthlyBudget: 800000,
    },
  });
  const accAMeta = await prisma.adAccount.create({
    data: {
      id: 'acc_a_meta', tenantId: TENANT_ID, clientId: clientA.id,
      platform: 'meta', externalAccountId: 'act_1111111', name: 'A社 Meta広告',
      monthlyBudget: 400000,
    },
  });
  const accBMeta = await prisma.adAccount.create({
    data: {
      id: 'acc_b_meta', tenantId: TENANT_ID, clientId: clientB.id,
      platform: 'meta', externalAccountId: 'act_2222222', name: 'B社 Meta広告',
      monthlyBudget: 600000,
    },
  });
  const accBLine = await prisma.adAccount.create({
    data: {
      id: 'acc_b_line', tenantId: TENANT_ID, clientId: clientB.id,
      platform: 'line_ads', externalAccountId: 'L-33333', name: 'B社 LINE広告',
      monthlyBudget: 300000,
    },
  });
  const accCGoogle = await prisma.adAccount.create({
    data: {
      id: 'acc_c_google', tenantId: TENANT_ID, clientId: clientC.id,
      platform: 'google_ads', externalAccountId: '234-567-8901',
      name: 'C社 Google広告', monthlyBudget: 1200000,
    },
  });
  const accCYahoo = await prisma.adAccount.create({
    data: {
      id: 'acc_c_yahoo', tenantId: TENANT_ID, clientId: clientC.id,
      platform: 'yahoo_search', externalAccountId: 'Y-44444', name: 'C社 Yahoo!検索広告',
      monthlyBudget: 500000,
    },
  });

  // A社 Google: 好調 (直近CV改善)
  await seedFacts(accAGoogle.id, 'google_ads', [
    { campaignId: 'g-brand', campaignName: 'ブランド検索', baseCost: 8000, baseCtr: 0.06, baseCvr: 0.05, avgOrderValue: 9000, recentConvFactor: 1.15 },
    { campaignId: 'g-generic', campaignName: '一般KW検索', baseCost: 14000, baseCtr: 0.02, baseCvr: 0.018, avgOrderValue: 9000 },
  ]);
  // A社 Meta: 安定
  await seedFacts(accAMeta.id, 'meta', [
    { campaignId: 'm-prospect', campaignName: '新規獲得', baseCost: 9000, baseCtr: 0.009, baseCvr: 0.012, avgOrderValue: 8500 },
    { campaignId: 'm-retarget', campaignName: 'リターゲティング', baseCost: 4000, baseCtr: 0.012, baseCvr: 0.03, avgOrderValue: 8500 },
  ]);
  // B社 Meta: 直近7日でCPA悪化 (リタゲ疲弊パターン) → /audit が検出すべき
  await seedFacts(accBMeta.id, 'meta', [
    { campaignId: 'm-b-pros', campaignName: '新規獲得 (動画)', baseCost: 12000, baseCtr: 0.008, baseCvr: 0.01, avgOrderValue: 12000, recentConvFactor: 0.55 },
    { campaignId: 'm-b-ret', campaignName: 'リターゲティング', baseCost: 7000, baseCtr: 0.014, baseCvr: 0.025, avgOrderValue: 12000, recentConvFactor: 0.6 },
  ]);
  // B社 LINE: CV計測ゼロ (計測欠落の疑い) → /audit 計測カテゴリが検出すべき
  await seedFacts(accBLine.id, 'line_ads', [
    { campaignId: 'l-b-main', campaignName: 'トークリスト配信', baseCost: 9000, baseCtr: 0.007, baseCvr: 0.01, avgOrderValue: 12000, zeroConversions: true },
  ]);
  // C社 Google: 安定・高単価
  await seedFacts(accCGoogle.id, 'google_ads', [
    { campaignId: 'g-c-brand', campaignName: 'ブランド検索', baseCost: 10000, baseCtr: 0.07, baseCvr: 0.06, avgOrderValue: 150000 },
    { campaignId: 'g-c-comp', campaignName: '競合KW', baseCost: 24000, baseCtr: 0.015, baseCvr: 0.008, avgOrderValue: 150000 },
  ]);
  // C社 Yahoo!: 安定
  await seedFacts(accCYahoo.id, 'yahoo_search', [
    { campaignId: 'y-c-main', campaignName: '指名+一般検索', baseCost: 15000, baseCtr: 0.04, baseCvr: 0.03, avgOrderValue: 150000 },
  ]);

  await prisma.mediaConnection.createMany({
    data: [
      { tenantId: TENANT_ID, platform: 'google_ads', status: 'connected', lastSyncedAt: new Date() },
      { tenantId: TENANT_ID, platform: 'meta', status: 'connected', lastSyncedAt: new Date() },
      { tenantId: TENANT_ID, platform: 'yahoo_search', status: 'needs_reauth', lastSyncedAt: daysAgo(2) },
      { tenantId: TENANT_ID, platform: 'line_ads', status: 'not_connected' },
    ],
  });

  // A/Bテストのデモ (B-3): 有意差ありと継続中の2件
  await prisma.abTest.createMany({
    data: [
      {
        tenantId: TENANT_ID, clientId: clientA.id,
        name: '訴求軸テスト: 便益 vs 損失回避', hypothesis: '損失回避訴求の方がCVRが高い', metric: 'cvr',
        aLabel: '便益訴求', aImpr: 50000, aClicks: 1000, aConv: 50,
        bLabel: '損失回避訴求', bImpr: 50000, bClicks: 1000, bConv: 88,
      },
      {
        tenantId: TENANT_ID, clientId: clientB.id,
        name: 'バナー色テスト: 青 vs 赤', hypothesis: '赤バナーのCTRが高い', metric: 'ctr',
        aLabel: '青バナー', aImpr: 8000, aClicks: 80, aConv: 4,
        bLabel: '赤バナー', bImpr: 8000, bClicks: 95, bConv: 5,
      },
    ],
  });

  // 勝ちパターン資産集のデモ (B-1): 自社2件+匿名共有3件
  await prisma.knowledgeAsset.createMany({
    data: [
      { tenantId: TENANT_ID, industryCode: 'ec', objective: 'conversion', appealAxis: '損失回避', creativeSummary: '「まだ手作業ですか?」形式の問いかけ見出し', platform: 'meta', winRate: 0.088, sampleSize: 88, liftPct: 76, sourceAnonymized: false },
      { tenantId: TENANT_ID, industryCode: 'beauty', objective: 'conversion', appealAxis: '社会的証明', creativeSummary: '利用者数を前面に出したバナー', platform: 'line_ads', winRate: 0.032, sampleSize: 64, liftPct: 22, sourceAnonymized: false },
      { tenantId: null, industryCode: 'ec', objective: 'conversion', appealAxis: '緊急性・限定', creativeSummary: '在庫・期限を明示した訴求 (景表法に配慮した実期限のみ)', platform: '', winRate: 0.075, sampleSize: 210, liftPct: 41, sourceAnonymized: true },
      { tenantId: null, industryCode: 'saas', objective: 'conversion', appealAxis: '簡便性', creativeSummary: '「5分で導入完了」の即時性訴求', platform: '', winRate: 0.028, sampleSize: 180, liftPct: 33, sourceAnonymized: true },
      { tenantId: null, industryCode: 'beauty', objective: 'awareness', appealAxis: '便益', creativeSummary: 'ビフォーアフターを想起させる便益表現 (薬機法配慮)', platform: '', winRate: 0.021, sampleSize: 150, liftPct: 18, sourceAnonymized: true },
    ],
  });

  // 確信度較正のデモ (A-4): 計測は採用されやすい、構造は見送られやすい傾向
  await prisma.calibrationStat.createMany({
    data: [
      { category: 'measurement', adopted: 9, dismissed: 2 },
      { category: 'budget', adopted: 7, dismissed: 5 },
      { category: 'bidding', adopted: 6, dismissed: 6 },
      { category: 'structure', adopted: 2, dismissed: 9 },
      { category: 'creative', adopted: 5, dismissed: 4 },
    ],
  });

  // 変更履歴のデモ (B-2): ADGRID経由の変更と媒体側変更の混在
  await prisma.changeLog.createMany({
    data: [
      { tenantId: TENANT_ID, adAccountId: accAGoogle.id, actor: 'adgrid', actorName: 'デモ 運用者', entity: 'account', field: 'budget', oldValue: '800000', newValue: '700000', note: '承認提案「予算最適化」により変更', changedAt: daysAgo(3) },
      { tenantId: TENANT_ID, adAccountId: accBMeta.id, actor: 'media_console', actorName: '媒体管理画面', entity: 'campaign', field: 'bid', oldValue: '150', newValue: '180', note: '媒体側で入札を手動変更', changedAt: daysAgo(2) },
      { tenantId: TENANT_ID, adAccountId: accBMeta.id, actor: 'media_console', actorName: '媒体管理画面', entity: 'campaign', field: 'status', oldValue: 'active', newValue: 'paused', note: '審査落ちにより一時停止', changedAt: daysAgo(1) },
    ],
  });

  // カスタムダッシュボードのデモ (B-5)
  await prisma.dashboard.create({
    data: {
      tenantId: TENANT_ID,
      name: '経営サマリ',
      isDefault: true,
      layout: [
        { id: 'w1', type: 'stat', title: '消化額 (7日)', metric: 'cost', dimension: 'none', width: 1, days: 7 },
        { id: 'w2', type: 'stat', title: 'CV (7日)', metric: 'conversions', dimension: 'none', width: 1, days: 7 },
        { id: 'w3', type: 'stat', title: 'CPA (7日)', metric: 'cpa', dimension: 'none', width: 1, days: 7 },
        { id: 'w4', type: 'bar', title: '媒体別 消化額', metric: 'cost', dimension: 'platform', width: 2, days: 7 },
        { id: 'w5', type: 'bar', title: 'クライアント別 CV', metric: 'conversions', dimension: 'client', width: 1, days: 7 },
        { id: 'w6', type: 'line', title: '日次 消化額の推移', metric: 'cost', dimension: 'date', width: 3, days: 14 },
      ],
    },
  });

  console.log('Seed done. tenant =', TENANT_ID);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
