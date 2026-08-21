import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditResultSchema } from '@adgrid/shared';
import type { AuditFinding, AuditResult, AuditRunDto } from '@adgrid/shared';
import { PrismaService, Tx } from '../prisma/prisma.service';
import { benchmarkFor } from '@adgrid/shared';
import { AppError } from '../common/errors';
import { TrailService } from '../common/trail.service';
import { MetricsService, Totals, daysAgo, isoDate } from '../metrics/metrics.service';
import { LlmService } from './llm.service';
import { AUDIT_VERIFIER, OUTPUT_SCHEMAS, PROMPTS } from './prompt-registry';

interface CampaignWindow {
  campaignId: string;
  campaignName: string;
  last7: Totals;
  prior7: Totals;
  last28: Totals;
}

interface AuditInput {
  account: { id: string; name: string; platform: string; monthlyBudget: number | null };
  /** 業種別ベンチマーク (A-3)。診断の判断軸を「時系列」から「業種相場比」に広げる */
  industryBenchmark: { label: string; ctr: number; cvr: number; cpa: number };
  period: { since: string; until: string };
  monthToDateCost: number;
  monthElapsedRatio: number;
  accountLast7: Totals;
  accountPrior7: Totals;
  accountLast28: Totals;
  campaigns: CampaignWindow[];
}

function cpa(t: Totals): number | null {
  return t.conversions > 0 ? Math.round(t.cost / t.conversions) : null;
}
function ctr(t: Totals): number | null {
  return t.impressions > 0 ? +((t.clicks / t.impressions) * 100).toFixed(2) : null;
}

@Injectable()
export class AuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
    private readonly llm: LlmService,
    private readonly trail: TrailService,
  ) {}

  /* ---------------- 入力データ構築 ---------------- */

  private async buildInput(tx: Tx, adAccountId: string): Promise<AuditInput> {
    const account = await tx.adAccount.findUnique({ where: { id: adAccountId }, include: { client: true } });
    if (!account) {
      throw new AppError(
        HttpStatus.NOT_FOUND,
        '広告アカウントが見つかりません。',
        'アカウントを選び直してください。',
      );
    }
    const bm = benchmarkFor(account.client.industryCode);
    const [last7, prior7, last28] = await Promise.all([
      this.metrics.totals(tx, { adAccountId }, daysAgo(6), daysAgo(0)),
      this.metrics.totals(tx, { adAccountId }, daysAgo(13), daysAgo(7)),
      this.metrics.totals(tx, { adAccountId }, daysAgo(27), daysAgo(0)),
    ]);

    const campaignRows = await tx.factAdPerformance.groupBy({
      by: ['campaignId', 'campaignName'],
      where: { adAccountId, date: { gte: daysAgo(27) } },
      _sum: { cost: true },
    });
    const campaigns: CampaignWindow[] = [];
    for (const row of campaignRows) {
      const filterC = { adAccountId };
      const wc = (s: Date, u: Date) =>
        tx.factAdPerformance
          .aggregate({
            where: { ...filterC, campaignId: row.campaignId, date: { gte: s, lte: u } },
            _sum: { cost: true, impressions: true, clicks: true, conversions: true, conversionValue: true },
          })
          .then((a) => ({
            cost: Number(a._sum.cost ?? 0),
            impressions: Number(a._sum.impressions ?? 0),
            clicks: Number(a._sum.clicks ?? 0),
            conversions: Number(a._sum.conversions ?? 0),
            conversionValue: Number(a._sum.conversionValue ?? 0),
          }));
      const [l7, p7, l28] = await Promise.all([
        wc(daysAgo(6), daysAgo(0)),
        wc(daysAgo(13), daysAgo(7)),
        wc(daysAgo(27), daysAgo(0)),
      ]);
      campaigns.push({
        campaignId: row.campaignId,
        campaignName: row.campaignName,
        last7: l7,
        prior7: p7,
        last28: l28,
      });
    }
    campaigns.sort((a, b) => b.last28.cost - a.last28.cost);

    const monthStart = daysAgo(0);
    monthStart.setUTCDate(1);
    const mtd = await this.metrics.totals(tx, { adAccountId }, monthStart, daysAgo(0));
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

    return {
      account: {
        id: account.id,
        name: account.name,
        platform: account.platform,
        monthlyBudget: account.monthlyBudget ? Number(account.monthlyBudget) : null,
      },
      industryBenchmark: { label: bm.label, ctr: bm.ctr, cvr: bm.cvr, cpa: bm.cpa },
      period: { since: isoDate(daysAgo(27)), until: isoDate(daysAgo(0)) },
      monthToDateCost: mtd.cost,
      monthElapsedRatio: +(now.getDate() / daysInMonth).toFixed(2),
      accountLast7: last7,
      accountPrior7: prior7,
      accountLast28: last28,
      campaigns,
    };
  }

  /* ---------------- ルールベース診断 (モックモード) ----------------
   * AIロジック設計の定石パターンの決定的実装。
   * APIキーがあれば LLM 診断がこれを置き換える。 */

  private ruleBasedAudit(input: AuditInput): AuditResult {
    const findings: AuditFinding[] = [];
    const period7 = '直近7日';

    // 1. 計測: クリック多数でCV=0
    if (input.accountLast7.clicks >= 200 && input.accountLast7.conversions === 0) {
      findings.push({
        priority_rank: 0,
        category: 'measurement',
        title: 'CV計測の欠落疑い — クリックがあるのにCVが0件',
        body: `直近7日でクリックが${input.accountLast7.clicks.toLocaleString('ja-JP')}件発生しているのに、コンバージョン (CV: 成果地点の獲得数) が0件です。広告の問題ではなく、計測タグの欠落・発火不良の可能性が高い状態です。タグの設置と発火をまず確認してください。計測が直るまで、このアカウントの他の数値判断は保留を推奨します。`,
        evidence: {
          metrics_cited: [
            { name: 'クリック数', value: String(input.accountLast7.clicks), period: period7 },
            { name: 'CV数', value: '0', period: period7 },
          ],
          reasoning: 'クリック200件以上でCV0件が継続する場合、計測欠落が最有力の定石パターン。',
        },
        expected_impact: '計測回復により実態のCPA評価が可能になり、以降の全改善判断の前提が整う',
        risk: 'タグ再設置の際に二重計測を作らないよう、既存タグの棚卸しが必要',
        confidence: 'high',
        impact_level: 3,
        ease_level: 2,
      });
    }

    // 2. 予算ペーシング
    if (input.account.monthlyBudget && input.account.monthlyBudget > 0) {
      const pace = input.monthToDateCost / input.account.monthlyBudget / input.monthElapsedRatio;
      if (pace > 1.2) {
        findings.push({
          priority_rank: 0,
          category: 'budget',
          title: '予算超過ペース — 月内で予算に到達する見込み',
          body: `月予算¥${input.account.monthlyBudget.toLocaleString('ja-JP')}に対し、月初からの消化額は¥${Math.round(input.monthToDateCost).toLocaleString('ja-JP')}です。月の経過率${Math.round(input.monthElapsedRatio * 100)}%に対して消化が先行しています。成果の良いキャンペーンを残して日予算を調整し、月末の配信停止 (機会損失) を避けてください。`,
          evidence: {
            metrics_cited: [
              { name: '月初からの消化額', value: String(Math.round(input.monthToDateCost)), period: '今月' },
              { name: '月予算', value: String(input.account.monthlyBudget), period: '今月' },
            ],
            reasoning: '消化ペース÷月経過率が1.2を超過。',
          },
          expected_impact: '月末の強制停止を回避し、配信の連続性と学習の安定を維持',
          risk: '日予算を絞ると獲得件数自体は一時的に減少する',
          confidence: 'high',
          impact_level: 2,
          ease_level: 3,
        });
      } else if (pace < 0.8 && input.monthElapsedRatio > 0.3) {
        findings.push({
          priority_rank: 0,
          category: 'budget',
          title: '予算未消化 — 配信機会を取りこぼしている可能性',
          body: `月の経過率${Math.round(input.monthElapsedRatio * 100)}%に対し、消化は予算比${Math.round((input.monthToDateCost / input.account.monthlyBudget) * 100)}%に留まっています。成果の良いキャンペーンの日予算・入札を引き上げ、計画通りの配信量を確保してください。`,
          evidence: {
            metrics_cited: [
              { name: '月初からの消化額', value: String(Math.round(input.monthToDateCost)), period: '今月' },
              { name: '月予算', value: String(input.account.monthlyBudget), period: '今月' },
            ],
            reasoning: '消化ペース÷月経過率が0.8未満。',
          },
          expected_impact: '未消化分の予算で追加CVを獲得できる余地',
          risk: '拡大に伴いCPA (獲得単価) が一時的に上昇する可能性',
          confidence: 'mid',
          impact_level: 2,
          ease_level: 3,
        });
      }
    }

    // 3-4. キャンペーン別CPA悪化 (入札/クリエイティブ)
    for (const c of input.campaigns) {
      const curCpa = cpa(c.last7);
      const prevCpa = cpa(c.prior7);
      if (curCpa && prevCpa && curCpa > prevCpa * 1.3 && c.last7.cost > 10000) {
        const curCtr = ctr(c.last7);
        const prevCtr = ctr(c.prior7);
        const ctrDropped = curCtr !== null && prevCtr !== null && curCtr < prevCtr * 0.8;
        findings.push({
          priority_rank: 0,
          category: ctrDropped ? 'creative' : 'bidding',
          title: `「${c.campaignName}」のCPA悪化 — 前週比+${Math.round(((curCpa - prevCpa) / prevCpa) * 100)}%`,
          body: ctrDropped
            ? `「${c.campaignName}」のCPA (獲得単価) が直近7日で¥${curCpa.toLocaleString('ja-JP')}と前週の¥${prevCpa.toLocaleString('ja-JP')}から悪化しました。CTR (クリック率) も${prevCtr}%→${curCtr}%に低下しており、クリエイティブの疲弊 (同じ広告の見飽き) が疑われます。新しい訴求・素材の追加テストを推奨します。`
            : `「${c.campaignName}」のCPAが直近7日で¥${curCpa.toLocaleString('ja-JP')}と前週の¥${prevCpa.toLocaleString('ja-JP')}から悪化しました。CTRは維持されているため、入札・オークション環境の変化が疑われます。入札設定と検索語句・配信面の変化を確認してください。`,
          evidence: {
            metrics_cited: [
              { name: 'CPA', value: String(curCpa), period: period7 },
              { name: 'CPA', value: String(prevCpa), period: '前週7日' },
            ],
            reasoning: 'CPA前週比+30%超かつ費用規模が十分。CTR動向でクリエイティブ要因と入札要因を切り分け。',
          },
          expected_impact: `前週水準への回復で月間¥${Math.round((curCpa - prevCpa) * c.last7.conversions * 4).toLocaleString('ja-JP')}前後の効率改善余地`,
          risk: 'クリエイティブ変更直後は学習リセットで数日成果が不安定になる',
          confidence: 'mid',
          impact_level: 2,
          ease_level: 2,
        });
      }
    }

    // A-3: 業種ベンチマークとの乖離 (CVRが相場を大きく下回る)
    const accCvr = input.accountLast28.clicks > 0
      ? +((input.accountLast28.conversions / input.accountLast28.clicks) * 100).toFixed(2)
      : null;
    const bm = input.industryBenchmark;
    if (accCvr !== null && input.accountLast28.clicks >= 300 && accCvr < bm.cvr * 0.7) {
      findings.push({
        priority_rank: 0,
        category: 'structure',
        title: `CVRが業種相場を下回る — ${bm.label}平均${bm.cvr}%に対し${accCvr}%`,
        body: `直近28日のCVR (クリック→CV率) は${accCvr}%で、${bm.label}の相場${bm.cvr}%を約${Math.round((1 - accCvr / bm.cvr) * 100)}%下回っています。広告とLP (ランディングページ) の訴求一致、フォーム離脱、計測設定を確認してください。クリック後の体験に改善余地がある可能性が高い状態です。`,
        evidence: {
          metrics_cited: [
            { name: 'CVR', value: `${accCvr}%`, period: '直近28日' },
            { name: '業種相場CVR', value: `${bm.cvr}%`, period: bm.label },
          ],
          reasoning: `業種ベンチマーク比0.7倍未満かつ十分なクリック量 (${input.accountLast28.clicks})。アカウント内時系列では見えない相場乖離。`,
        },
        expected_impact: `CVRを相場水準まで戻せれば、同じ費用でCV数が最大約${Math.round((bm.cvr / accCvr - 1) * 100)}%増える余地`,
        risk: 'LP改善は制作コストと時間を要する。まず計測の正しさを確認すること',
        confidence: 'mid',
        impact_level: 3,
        ease_level: 1,
      });
    }

    // 5. テスト設計: 1キャンペーン集中
    if (input.campaigns.length === 1 && input.accountLast28.cost > 100000) {
      findings.push({
        priority_rank: 0,
        category: 'structure',
        title: '配信構造が単一キャンペーンに集中 — テスト設計の余地',
        body: `直近28日の費用¥${Math.round(input.accountLast28.cost).toLocaleString('ja-JP')}が単一キャンペーンに集中しています。訴求・オーディエンスの比較テストができない構造のため、検証用の分割を検討してください。`,
        evidence: {
          metrics_cited: [
            { name: '28日費用', value: String(Math.round(input.accountLast28.cost)), period: '直近28日' },
          ],
          reasoning: '規模に対して構造が単一で、勝ち筋の検証手段がない。',
        },
        expected_impact: 'テスト構造の確立により中期的なCPA改善の再現性を獲得',
        risk: '分割直後は学習データが分散し一時的に効率が落ちる',
        confidence: 'low',
        impact_level: 1,
        ease_level: 1,
      });
    }

    // 優先度順: 計測 → その他 impact*ease*confidence
    const cw = { high: 1.0, mid: 0.7, low: 0.4 } as const;
    findings.sort((a, b) => {
      if (a.category === 'measurement' !== (b.category === 'measurement')) {
        return a.category === 'measurement' ? -1 : 1;
      }
      return b.impact_level * b.ease_level * cw[b.confidence] - a.impact_level * a.ease_level * cw[a.confidence];
    });
    findings.forEach((f, i) => (f.priority_rank = i + 1));

    const good =
      input.accountLast7.conversions > 0 &&
      (cpa(input.accountLast7) ?? Infinity) <= (cpa(input.accountPrior7) ?? Infinity)
        ? 'CPAは前週から維持・改善しており、基調は良好です。'
        : '全体としては安定した配信が続いています。';

    return {
      summary: `${input.account.name}の直近28日を診断しました。${good}優先対応は${findings.length}件です。${
        findings.length === 0 ? '現時点で重要な指摘はありません。' : ''
      }`,
      diagnosis_scope: {
        period: `${input.period.since}〜${input.period.until}`,
        data_sufficiency: input.accountLast28.clicks >= 100 ? 'full' : 'limited',
        excluded_categories: input.accountLast28.clicks >= 100 ? [] : ['bidding', 'creative'],
      },
      findings: findings.slice(0, 10),
      data_requests:
        input.accountLast28.clicks >= 100
          ? []
          : [
              {
                needed_data: 'クリック100件以上の実績データ (現在' + input.accountLast28.clicks + '件)',
                reason: '統計的判断を要する入札・クリエイティブ診断には最低限のデータ量が必要なため',
              },
            ],
    };
  }

  /* ---------------- LLM診断 (実モード) ---------------- */

  /** 根拠数値の実在検証: 引用値が入力データに存在しない指摘を破棄 (要件書 §8) */
  private verifyCitations(result: AuditResult, input: AuditInput): AuditResult {
    const haystack = JSON.stringify(input).replace(/[,¥%\s]/g, '');
    const ok = result.findings.filter((f) =>
      f.evidence.metrics_cited.every((m) => {
        const digits = m.value.replace(/[^\d.]/g, '');
        if (digits.length < 2) return true; // 短すぎる数値は検証対象外
        return haystack.includes(digits.split('.')[0]);
      }),
    );
    ok.forEach((f, i) => (f.priority_rank = i + 1));
    return { ...result, findings: ok };
  }

  private async llmAudit(tenantId: string, input: AuditInput): Promise<AuditResult> {
    const user = [
      `以下のスキーマのJSONのみを出力してください:\n${OUTPUT_SCHEMAS.audit}`,
      `<tenant_context>\n月予算: ${input.account.monthlyBudget ?? '未設定'} / 媒体: ${input.account.platform}\n業種相場 (${input.industryBenchmark.label}): CTR ${input.industryBenchmark.ctr}% / CVR ${input.industryBenchmark.cvr}% / CPA ¥${input.industryBenchmark.cpa}。実績を業種相場と比較した指摘も行うこと。\n</tenant_context>`,
      `<account_data>\n${JSON.stringify(input, null, 1)}\n</account_data>`,
    ].join('\n\n');
    const text = await this.llm.completeText({
      tenantId,
      feature: 'audit',
      model: PROMPTS.audit.model,
      system: PROMPTS.audit.system,
      user,
      promptVersion: PROMPTS.audit.version,
    });
    const parsed = AuditResultSchema.safeParse(LlmService.parseJson(text));
    if (!parsed.success) {
      throw new AppError(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'AI診断の出力がスキーマ検証に失敗しました。',
        'もう一度実行してください。続く場合はモック診断をご利用ください。',
      );
    }
    // 1段目: アプリ層の数値実在チェック / 2段目: LLM自己検証 (A-1)
    const citationChecked = this.verifyCitations(parsed.data, input);
    return this.selfVerify(tenantId, citationChecked, input);
  }

  /** A-1 LLM自己検証パス: 生成診断を別プロンプトで批判的に再チェックし、捏造・飛躍を除外 */
  private async selfVerify(tenantId: string, result: AuditResult, input: AuditInput): Promise<AuditResult> {
    if (result.findings.length === 0) return result;
    try {
      const user = [
        `検証対象の診断結果:\n${JSON.stringify({ findings: result.findings })}`,
        `<account_data>\n${JSON.stringify(input, null, 1)}\n</account_data>`,
        `以下のスキーマのJSONのみを出力してください:\n${AUDIT_VERIFIER.schema}`,
      ].join('\n\n');
      const text = await this.llm.completeText({
        tenantId,
        feature: 'audit',
        model: AUDIT_VERIFIER.model,
        system: AUDIT_VERIFIER.system,
        user,
        promptVersion: AUDIT_VERIFIER.version,
      });
      const v = LlmService.parseJson(text) as {
        verified_ranks?: number[];
        rejected?: Array<{ rank: number }>;
        confidence_downgrade?: number[];
      };
      const rejected = new Set((v.rejected ?? []).map((r) => r.rank));
      const downgrade = new Set(v.confidence_downgrade ?? []);
      const kept = result.findings
        .filter((f) => !rejected.has(f.priority_rank))
        .map((f) =>
          downgrade.has(f.priority_rank) && f.confidence !== 'low'
            ? { ...f, confidence: (f.confidence === 'high' ? 'mid' : 'low') as AuditFinding['confidence'] }
            : f,
        );
      kept.forEach((f, i) => (f.priority_rank = i + 1));
      return { ...result, findings: kept };
    } catch {
      // 検証パスの失敗で診断全体を落とさない (1段目の数値チェックは通過済み)
      return result;
    }
  }

  /* ---------------- 実行・取得 ---------------- */

  private toDto(row: {
    id: string;
    adAccountId: string;
    createdAt: Date;
    promptVersion: string;
    model: string;
    mocked: boolean;
    result: unknown;
    findingStatuses: unknown;
  }): AuditRunDto {
    return {
      id: row.id,
      adAccountId: row.adAccountId,
      createdAt: row.createdAt.toISOString(),
      promptVersion: row.promptVersion,
      model: row.model,
      mocked: row.mocked,
      result: row.result as AuditRunDto['result'],
      findingStatuses: (row.findingStatuses ?? {}) as AuditRunDto['findingStatuses'],
    };
  }

  async run(tenantId: string, adAccountId: string): Promise<AuditRunDto> {
    const input = await this.prisma.withTenant(tenantId, (tx) => this.buildInput(tx, adAccountId));

    let result: AuditResult;
    let mocked = false;
    if (this.llm.available) {
      result = await this.llmAudit(tenantId, input);
    } else {
      result = this.ruleBasedAudit(input);
      mocked = true;
    }

    const row = await this.prisma.withTenant(tenantId, (tx) =>
      tx.audit.create({
        data: {
          tenantId,
          adAccountId,
          promptVersion: mocked ? 'rule-based.v1' : PROMPTS.audit.version,
          model: mocked ? 'rule-based' : PROMPTS.audit.model,
          mocked,
          result: result as object,
        },
      }),
    );
    await this.trail.record({
      tenantId,
      action: 'audit_run',
      resource: adAccountId,
      detail: { auditId: row.id, mocked, findings: result.findings.length },
    });
    return this.toDto(row);
  }

  async list(tenantId: string, adAccountId?: string): Promise<AuditRunDto[]> {
    const rows = await this.prisma.withTenant(tenantId, (tx) =>
      tx.audit.findMany({
        where: adAccountId ? { adAccountId } : {},
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    );
    return rows.map((r) => this.toDto(r));
  }

  async get(tenantId: string, id: string): Promise<AuditRunDto> {
    const row = await this.prisma.withTenant(tenantId, (tx) => tx.audit.findUnique({ where: { id } }));
    if (!row) {
      throw new AppError(HttpStatus.NOT_FOUND, '診断が見つかりません。', '一覧から選び直してください。');
    }
    return this.toDto(row);
  }

  async setFindingStatus(
    tenantId: string,
    id: string,
    rank: number,
    status: 'open' | 'adopted' | 'dismissed',
  ): Promise<AuditRunDto> {
    const row = await this.prisma.withTenant(tenantId, async (tx) => {
      const audit = await tx.audit.findUnique({ where: { id } });
      if (!audit) {
        throw new AppError(HttpStatus.NOT_FOUND, '診断が見つかりません。', '一覧から選び直してください。');
      }
      const statuses = { ...((audit.findingStatuses ?? {}) as Record<string, string>) };
      statuses[String(rank)] = status;
      return tx.audit.update({ where: { id }, data: { findingStatuses: statuses } });
    });
    return this.toDto(row);
  }
}
