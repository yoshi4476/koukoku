import { HttpStatus, Injectable } from '@nestjs/common';
import { ReportResultSchema } from '@adgrid/shared';
import type { ReportResult, ReportRunDto, AuditResult, PlatformBreakdownDto } from '@adgrid/shared';
import { PLATFORM_META } from '@adgrid/shared';
import type { Platform } from '@adgrid/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/errors';
import { TrailService } from '../common/trail.service';
import { MetricsService, Totals, daysAgo, isoDate } from '../metrics/metrics.service';
import { LlmService } from './llm.service';
import { OUTPUT_SCHEMAS, PROMPTS } from './prompt-registry';

interface ReportInput {
  clientName: string;
  period: { since: string; until: string };
  current: Totals;
  previous: Totals;
  byPlatform: PlatformBreakdownDto[];
  latestFindings: Array<{ title: string; expected_impact: string; risk: string }>;
}

function jpDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00');
  const w = ['日', '月', '火', '水', '木', '金', '土'][d.getDay()];
  return `${d.getMonth() + 1}/${d.getDate()}(${w})`;
}

function fmtYen(n: number): string {
  return '¥' + Math.round(n).toLocaleString('ja-JP');
}

function pct(cur: number, prev: number): string {
  if (!prev) return '—';
  const d = ((cur - prev) / prev) * 100;
  return `${d >= 0 ? '+' : ''}${d.toFixed(1)}%`;
}

@Injectable()
export class ReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
    private readonly llm: LlmService,
    private readonly trail: TrailService,
  ) {}

  private async buildInput(tenantId: string, clientId: string): Promise<ReportInput> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const client = await tx.client.findUnique({ where: { id: clientId } });
      if (!client) {
        throw new AppError(HttpStatus.NOT_FOUND, 'クライアントが見つかりません。', 'クライアントを選び直してください。');
      }
      const [current, previous, byPlatform] = await Promise.all([
        this.metrics.totals(tx, { clientId }, daysAgo(6), daysAgo(0)),
        this.metrics.totals(tx, { clientId }, daysAgo(13), daysAgo(7)),
        this.metrics.byPlatform(tx, { clientId }, daysAgo(6), daysAgo(0), daysAgo(13), daysAgo(7)),
      ]);
      const audits = await tx.audit.findMany({
        where: { adAccount: { clientId } },
        orderBy: { createdAt: 'desc' },
        take: 3,
      });
      const latestFindings = audits
        .flatMap((a) => ((a.result as unknown as AuditResult).findings ?? []).slice(0, 2))
        .slice(0, 3)
        .map((f) => ({ title: f.title, expected_impact: f.expected_impact, risk: f.risk }));
      return {
        clientName: client.name,
        period: { since: isoDate(daysAgo(6)), until: isoDate(daysAgo(0)) },
        current,
        previous,
        byPlatform,
        latestFindings,
      };
    });
  }

  /** テンプレートベース生成 (モックモード)。数値はすべて実データ由来 */
  private templateReport(input: ReportInput): ReportResult {
    const { current: c, previous: p } = input;
    const cpa = c.conversions > 0 ? c.cost / c.conversions : null;
    const prevCpa = p.conversions > 0 ? p.cost / p.conversions : null;
    const roas = c.cost > 0 ? (c.conversionValue / c.cost) * 100 : null;
    const cpaTrend =
      cpa !== null && prevCpa !== null ? (cpa <= prevCpa ? '改善' : '悪化') : '判定不能';

    const topPlatform = input.byPlatform[0];
    const worst = [...input.byPlatform]
      .filter((b) => b.cpaDelta !== null)
      .sort((a, b) => (b.cpaDelta ?? 0) - (a.cpaDelta ?? 0))[0];

    const resultBody = [
      `${jpDate(input.period.since)}〜${jpDate(input.period.until)}の実績です。`,
      `消化額は${fmtYen(c.cost)} (前週比 ${pct(c.cost, p.cost)})、CV (成果件数) は${c.conversions.toFixed(0)}件 (${pct(c.conversions, p.conversions)}) でした。`,
      cpa !== null
        ? `CPA (獲得単価) は${fmtYen(cpa)}で、前週から${cpaTrend}しています。`
        : 'CVが0件のためCPAは算出できません。計測状況の確認が必要です。',
      roas !== null ? `ROAS (広告費用対効果) は${roas.toFixed(0)}%です。` : '',
    ]
      .filter(Boolean)
      .join('');

    const causeParts: string[] = [];
    if (topPlatform) {
      causeParts.push(
        `費用構成では${PLATFORM_META[topPlatform.platform as Platform]?.label ?? topPlatform.platform}が${fmtYen(topPlatform.cost)}と最大です。`,
      );
    }
    if (worst && (worst.cpaDelta ?? 0) > 10) {
      causeParts.push(
        `${PLATFORM_META[worst.platform as Platform]?.label ?? worst.platform}のCPAが前週比+${worst.cpaDelta}%と悪化しており、全体CPAの押し上げ要因と考えられます。確認方法: 該当媒体のAI診断を実行し、要因を特定してください。`,
      );
    } else {
      causeParts.push('媒体別に大きな悪化はなく、全体は前週と同水準の構造です。');
    }

    const actions =
      input.latestFindings.length > 0
        ? input.latestFindings
            .map((f, i) => `${i + 1}. ${f.title}。期待効果: ${f.expected_impact}。リスク: ${f.risk}。`)
            .join('\n')
        : 'AI診断が未実行です。まず診断を実行し、優先度付きの改善提案を取得してください。';

    return {
      executive_summary: [
        `消化額${fmtYen(c.cost)} (前週比 ${pct(c.cost, p.cost)})、CV ${c.conversions.toFixed(0)}件 (${pct(c.conversions, p.conversions)})。`,
        cpa !== null ? `CPAは${fmtYen(cpa)}で${cpaTrend}。` : 'CV計測の確認が必要です。',
        '詳細と提案は本文をご確認ください。',
      ].join('\n'),
      sections: [
        { kind: 'result', heading: '結果 — 今週のKPI', body: resultBody },
        { kind: 'cause', heading: '要因 — 変動の内訳', body: causeParts.join('') },
        { kind: 'action', heading: '次のアクション', body: actions },
      ],
    };
  }

  async run(tenantId: string, clientId: string, periodType: 'weekly' | 'monthly'): Promise<ReportRunDto> {
    const input = await this.buildInput(tenantId, clientId);

    let result: ReportResult;
    let mocked = false;
    if (this.llm.available) {
      const user = [
        `以下のスキーマのJSONのみを出力してください:\n${OUTPUT_SCHEMAS.report}`,
        `<report_data>\n${JSON.stringify(input, null, 1)}\n</report_data>`,
        `<audit_findings>\n${JSON.stringify(input.latestFindings)}\n</audit_findings>`,
      ].join('\n\n');
      const text = await this.llm.completeText({
        tenantId,
        feature: 'report',
        model: PROMPTS.report.model,
        system: PROMPTS.report.system,
        user,
        promptVersion: PROMPTS.report.version,
      });
      const parsed = ReportResultSchema.safeParse(LlmService.parseJson(text));
      if (!parsed.success) {
        throw new AppError(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'レポート出力がスキーマ検証に失敗しました。',
          'もう一度生成してください。',
        );
      }
      result = parsed.data;
    } else {
      result = this.templateReport(input);
      mocked = true;
    }

    const row = await this.prisma.withTenant(tenantId, (tx) =>
      tx.report.create({
        data: {
          tenantId,
          clientId,
          periodType,
          periodStart: new Date(input.period.since + 'T00:00:00Z'),
          promptVersion: mocked ? 'template.v1' : PROMPTS.report.version,
          model: mocked ? 'template' : PROMPTS.report.model,
          mocked,
          result: result as object,
        },
      }),
    );
    await this.trail.record({
      tenantId,
      action: 'report_run',
      resource: clientId,
      detail: { reportId: row.id, mocked, periodType },
    });
    return {
      id: row.id,
      clientId: row.clientId,
      periodType: row.periodType as 'weekly' | 'monthly',
      periodStart: isoDate(row.periodStart),
      createdAt: row.createdAt.toISOString(),
      promptVersion: row.promptVersion,
      mocked: row.mocked,
      result,
    };
  }

  async list(tenantId: string, clientId?: string): Promise<ReportRunDto[]> {
    const rows = await this.prisma.withTenant(tenantId, (tx) =>
      tx.report.findMany({
        where: clientId ? { clientId } : {},
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    );
    return rows.map((row) => ({
      id: row.id,
      clientId: row.clientId,
      periodType: row.periodType as 'weekly' | 'monthly',
      periodStart: isoDate(row.periodStart),
      createdAt: row.createdAt.toISOString(),
      promptVersion: row.promptVersion,
      mocked: row.mocked,
      result: row.result as unknown as ReportResult,
    }));
  }
}
