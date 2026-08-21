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
  tenantId: string = TENANT_ID,
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
        tenantId,
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
  await prisma.projectAsset.deleteMany({});
  await prisma.keywordStat.deleteMany({});
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
  await prisma.project.deleteMany({});
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

  // 検索キーワード実績 (キーワード最適化 F-18)。増額/維持/減額/停止・各ランキングを網羅する配分
  type KwSeed = {
    keyword: string; matchType: string; bid: number; qs: number;
    impr: number; clicks: number; cost: number; conv: number; convValue: number;
  };
  const seedKeywords = async (
    clientId: string, adAccountId: string, platform: string, kws: KwSeed[],
  ) => {
    await prisma.keywordStat.createMany({
      data: kws.map((k) => ({
        tenantId: TENANT_ID, clientId, adAccountId, platform,
        keyword: k.keyword, matchType: k.matchType, currentBid: k.bid, qualityScore: k.qs,
        impressions: k.impr, clicks: k.clicks, cost: k.cost, conversions: k.conv,
        conversionValue: k.convValue, windowDays: 28,
      })),
    });
  };
  // A社 Google (EC・物販): 相場 CPA4000 / CVR2.0 / CTR1.2
  await seedKeywords(clientA.id, accAGoogle.id, 'google_ads', [
    { keyword: 'アドグリッド 公式', matchType: 'exact', bid: 180, qs: 9, impr: 8000, clicks: 640, cost: 96000, conv: 40, convValue: 360000 },
    { keyword: 'スキンケア セット 送料無料', matchType: 'phrase', bid: 220, qs: 8, impr: 12000, clicks: 300, cost: 60000, conv: 15, convValue: 135000 },
    { keyword: '化粧品 通販 カテゴリ', matchType: 'phrase', bid: 320, qs: 6, impr: 20000, clicks: 300, cost: 90000, conv: 9, convValue: 81000 },
    { keyword: '美容液 口コミ ランキング', matchType: 'phrase', bid: 210, qs: 5, impr: 9000, clicks: 180, cost: 36000, conv: 4, convValue: 36000 },
    { keyword: '格安 化粧水', matchType: 'broad', bid: 150, qs: 4, impr: 30000, clicks: 450, cost: 67500, conv: 0, convValue: 0 },
    { keyword: '競合ブランド 比較', matchType: 'broad', bid: 200, qs: 6, impr: 6000, clicks: 90, cost: 18000, conv: 3, convValue: 27000 },
  ]);
  // C社 Google (BtoB SaaS): 相場 CPA15000 / CVR1.0 / CTR1.5・高単価
  await seedKeywords(clientC.id, accCGoogle.id, 'google_ads', [
    { keyword: 'クラウド勤怠 サービス名', matchType: 'exact', bid: 500, qs: 10, impr: 5000, clicks: 400, cost: 200000, conv: 30, convValue: 4500000 },
    { keyword: '勤怠管理 料金', matchType: 'phrase', bid: 1000, qs: 8, impr: 8000, clicks: 240, cost: 240000, conv: 12, convValue: 1800000 },
    { keyword: '業務効率化 ツール', matchType: 'phrase', bid: 800, qs: 5, impr: 25000, clicks: 375, cost: 300000, conv: 5, convValue: 750000 },
    { keyword: '競合SaaS 代替', matchType: 'phrase', bid: 800, qs: 7, impr: 6000, clicks: 120, cost: 96000, conv: 6, convValue: 900000 },
    { keyword: 'カテゴリ 比較 おすすめ', matchType: 'phrase', bid: 470, qs: 6, impr: 15000, clicks: 225, cost: 105000, conv: 5, convValue: 750000 },
    { keyword: '無料 勤怠 ツール', matchType: 'broad', bid: 400, qs: 4, impr: 40000, clicks: 600, cost: 240000, conv: 0, convValue: 0 },
  ]);
  // C社 Yahoo! (BtoB SaaS)
  await seedKeywords(clientC.id, accCYahoo.id, 'yahoo_search', [
    { keyword: 'サービス名 ヤフー', matchType: 'exact', bid: 400, qs: 9, impr: 3000, clicks: 210, cost: 84000, conv: 15, convValue: 2250000 },
    { keyword: '勤怠システム 導入', matchType: 'phrase', bid: 700, qs: 7, impr: 12000, clicks: 180, cost: 126000, conv: 6, convValue: 900000 },
    { keyword: '勤怠 安い', matchType: 'broad', bid: 300, qs: 4, impr: 18000, clicks: 270, cost: 81000, conv: 1, convValue: 150000 },
  ]);

  // プロジェクト (目的・施策単位)。複数媒体をまとめ、掲示/推移/アラート/改善のハブに
  const mkProject = async (
    id: string, clientId: string, name: string, goal: string, accountIds: string[], note = '',
    settings: Record<string, unknown> = {},
  ) => {
    await prisma.project.create({ data: { id, tenantId: TENANT_ID, clientId, name, goal, note, settings } });
    await prisma.adAccount.updateMany({ where: { id: { in: accountIds } }, data: { projectId: id } });
  };
  await mkProject('p_a_spring', clientA.id, '春の新規獲得キャンペーン', 'conversion', [accAGoogle.id, accAMeta.id], 'Google検索とMetaで新規顧客を獲得する主力施策', {
    monthlyBudgetTotal: 1600000, dailyBudget: 53000, targetCpa: 4000, targetRoas: 400, bidStrategy: 'target_cpa',
    startDate: '2026-03-01', endDate: '2026-05-31', regions: '全国', ageRange: '25-44', gender: 'female',
    devices: 'all', conversionPoint: '購入完了', dayparting: '終日', note: '母の日商戦に向けて5月は予算増額予定',
  });
  await mkProject('p_b_repeat', clientB.id, 'リピート促進 (LINE/Meta)', 'store', [accBMeta.id, accBLine.id], '既存顧客の再来店・再購入を狙う', {
    monthlyBudgetTotal: 700000, dailyBudget: 23000, targetCpa: 6000, targetRoas: null, bidStrategy: 'maximize_conversions',
    startDate: '2026-01-01', endDate: null, regions: '東京・神奈川・千葉・埼玉', ageRange: '20-49', gender: 'female',
    devices: 'mobile', conversionPoint: '来店予約', dayparting: '平日10-20時', note: '',
  });
  await mkProject('p_c_lead', clientC.id, 'BtoBリード獲得', 'conversion', [accCGoogle.id, accCYahoo.id], '検索広告で問い合わせ・資料請求を獲得', {
    monthlyBudgetTotal: 1700000, dailyBudget: 56000, targetCpa: 15000, targetRoas: null, bidStrategy: 'maximize_conversions',
    startDate: '2026-01-01', endDate: null, regions: '全国', ageRange: '指定なし', gender: 'all',
    devices: 'desktop', conversionPoint: '資料請求・問い合わせ', dayparting: '平日9-18時', note: 'PC・法人向けにデスクトップ重視',
  });

  // 制作物 (広告文/LP/チラシ/動画) のデモ。下書き〜公開の各段階を含む
  await prisma.projectAsset.createMany({
    data: [
      { tenantId: TENANT_ID, projectId: 'p_a_spring', type: 'copy', title: '検索広告 見出しA', content: '今だけ送料無料｜人気スキンケアをまとめ買い', status: 'published', publishedAt: daysAgo(3) },
      { tenantId: TENANT_ID, projectId: 'p_a_spring', type: 'lp', title: '春キャンペーン特設LP', url: 'https://example.com/lp/spring', content: '季節訴求のランディングページ', status: 'review' },
      { tenantId: TENANT_ID, projectId: 'p_a_spring', type: 'video', title: '紹介動画 (15秒)', url: 'https://example.com/video/spring15.mp4', content: 'Meta/リール用の縦型動画', status: 'draft' },
      { tenantId: TENANT_ID, projectId: 'p_a_spring', type: 'flyer', title: '店頭チラシ A4', url: 'https://example.com/flyer/spring_a4.png', content: '店頭配布用', status: 'approved' },
      { tenantId: TENANT_ID, projectId: 'p_b_repeat', type: 'copy', title: 'LINE配信 メッセージ', content: '【会員限定】ご来店で使える20%OFFクーポン配布中', status: 'published', publishedAt: daysAgo(1) },
      { tenantId: TENANT_ID, projectId: 'p_b_repeat', type: 'flyer', title: '再来店DMハガキ', url: 'https://example.com/flyer/dm.png', status: 'draft' },
      { tenantId: TENANT_ID, projectId: 'p_c_lead', type: 'copy', title: 'ホワイトペーパー訴求 見出し', content: '勤怠管理の「隠れコスト」を可視化｜無料DL', status: 'review' },
      { tenantId: TENANT_ID, projectId: 'p_c_lead', type: 'lp', title: '資料請求LP', url: 'https://example.com/lp/wp', status: 'published', publishedAt: daysAgo(5) },
    ],
  });

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

  // ── 提供先版(client edition)のデモテナント ──────────────────
  // 他社に下ろした版を実際に確認できるよう、自社データ閲覧中心の別テナントを用意。
  // デモログイン: client@adgrid.jp / demo-pass-2026
  const CLIENT_TENANT = 't_demo_client';
  await prisma.tenant.create({
    data: { id: CLIENT_TENANT, name: '自社EC事業部 (提供先版デモ)', plan: 'business', edition: 'client' },
  });
  const clientUser = await prisma.user.create({
    data: {
      email: 'client@adgrid.jp',
      passwordHash: await bcrypt.hash('demo-pass-2026', 10),
      name: '提供先 担当者',
    },
  });
  await prisma.tenantMember.create({
    data: { userId: clientUser.id, tenantId: CLIENT_TENANT, role: 'owner' },
  });
  const ecClient = await prisma.client.create({
    data: { id: 'cc_ec', tenantId: CLIENT_TENANT, name: '自社オンラインストア', industryCode: 'ec' },
  });
  const ccGoogle = await prisma.adAccount.create({
    data: {
      id: 'cc_acc_google', tenantId: CLIENT_TENANT, clientId: ecClient.id,
      platform: 'google_ads', externalAccountId: '999-888-7777',
      name: '自社EC Google広告', monthlyBudget: 600000,
    },
  });
  const ccMeta = await prisma.adAccount.create({
    data: {
      id: 'cc_acc_meta', tenantId: CLIENT_TENANT, clientId: ecClient.id,
      platform: 'meta', externalAccountId: 'act_9999999', name: '自社EC Meta広告', monthlyBudget: 400000,
    },
  });
  await seedFacts(ccGoogle.id, 'google_ads', [
    { campaignId: 'cc-brand', campaignName: 'ブランド検索', baseCost: 7000, baseCtr: 0.06, baseCvr: 0.045, avgOrderValue: 9000 },
    { campaignId: 'cc-generic', campaignName: '一般KW検索', baseCost: 12000, baseCtr: 0.02, baseCvr: 0.02, avgOrderValue: 9000 },
  ], CLIENT_TENANT);
  await seedFacts(ccMeta.id, 'meta', [
    { campaignId: 'cc-pros', campaignName: '新規獲得', baseCost: 8000, baseCtr: 0.01, baseCvr: 0.014, avgOrderValue: 8500 },
  ], CLIENT_TENANT);
  await prisma.keywordStat.createMany({
    data: [
      { tenantId: CLIENT_TENANT, clientId: ecClient.id, adAccountId: ccGoogle.id, platform: 'google_ads', keyword: '自社ストア 公式', matchType: 'exact', currentBid: 180, qualityScore: 9, impressions: 6000, clicks: 480, cost: 72000, conversions: 30, conversionValue: 270000, windowDays: 28 },
      { tenantId: CLIENT_TENANT, clientId: ecClient.id, adAccountId: ccGoogle.id, platform: 'google_ads', keyword: '通販 送料無料', matchType: 'phrase', currentBid: 250, qualityScore: 6, impressions: 18000, clicks: 270, cost: 81000, conversions: 6, conversionValue: 54000, windowDays: 28 },
    ],
  });
  await prisma.mediaConnection.createMany({
    data: [
      { tenantId: CLIENT_TENANT, platform: 'google_ads', status: 'connected', lastSyncedAt: new Date() },
      { tenantId: CLIENT_TENANT, platform: 'meta', status: 'connected', lastSyncedAt: new Date() },
    ],
  });
  await prisma.project.create({
    data: { id: 'p_cc_main', tenantId: CLIENT_TENANT, clientId: ecClient.id, name: '自社EC 集客プロジェクト', goal: 'conversion', note: 'Google・Metaで自社ストアの売上を伸ばす' },
  });
  await prisma.adAccount.updateMany({ where: { id: { in: [ccGoogle.id, ccMeta.id] } }, data: { projectId: 'p_cc_main' } });

  console.log('Seed done. tenants =', TENANT_ID, '/', CLIENT_TENANT);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
