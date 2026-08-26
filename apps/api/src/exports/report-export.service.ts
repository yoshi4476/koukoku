import { HttpStatus, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { chromium, type Browser } from 'playwright';
import PptxGenJS from 'pptxgenjs';
import type { ReportResult } from '@adgrid/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/errors';
import { TrailService } from '../common/trail.service';
import { isoDate } from '../metrics/metrics.service';

export interface ExportableReport {
  id: string;
  clientId: string;
  clientName: string;
  periodType: string;
  periodStart: string;
  createdAt: Date;
  mocked: boolean;
  result: ReportResult;
}

function jpDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  const w = ['日', '月', '火', '水', '木', '金', '土'][d.getUTCDay()];
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${w})`;
}

const SECTION_ORDER: Record<string, number> = { result: 0, cause: 1, action: 2 };

@Injectable()
export class ReportExportService implements OnModuleDestroy {
  private readonly logger = new Logger(ReportExportService.name);
  private browser: Browser | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly trail: TrailService,
  ) {}

  async load(tenantId: string, reportId: string): Promise<ExportableReport> {
    const row = await this.prisma.withTenant(tenantId, (tx) =>
      tx.report.findUnique({ where: { id: reportId }, include: { client: true } }),
    );
    if (!row) {
      throw new AppError(
        HttpStatus.NOT_FOUND,
        'レポートが見つかりません。',
        'レポート一覧から選び直してください。',
      );
    }
    return {
      id: row.id,
      clientId: row.clientId,
      clientName: row.client.name,
      periodType: row.periodType,
      periodStart: isoDate(row.periodStart),
      createdAt: row.createdAt,
      mocked: row.mocked,
      result: row.result as unknown as ReportResult,
    };
  }

  /* ---------------- PDF (Playwright HTML→PDF, 設計書⑤準拠) ---------------- */

  private renderHtml(r: ExportableReport): string {
    const sections = [...r.result.sections].sort(
      (a, b) => (SECTION_ORDER[a.kind] ?? 9) - (SECTION_ORDER[b.kind] ?? 9),
    );
    const esc = (s: string) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    // 期間終了は種別で変える。月次を常に +6日 で出すと「対象期間が1週間」になる
    const periodEnd = new Date(r.periodStart + 'T00:00:00Z');
    if (r.periodType === 'monthly') {
      periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);
      periodEnd.setUTCDate(0); // 当月の末日
    } else {
      periodEnd.setUTCDate(periodEnd.getUTCDate() + 6);
    }
    return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>
      * { box-sizing: border-box; }
      body { font-family: "Noto Sans JP", "Yu Gothic", "Hiragino Kaku Gothic ProN", sans-serif;
             color: #131F35; margin: 0; font-size: 11pt; line-height: 1.9; }
      .brand { color: #2456C4; font-weight: 700; letter-spacing: .08em; font-size: 10pt; }
      h1 { font-size: 20pt; margin: 4pt 0 6pt; }
      .meta { color: #64748F; font-size: 9pt; border-bottom: 1.5pt solid #C6D0E0; padding-bottom: 10pt; }
      .summary { background: #F5F7FB; border-left: 3pt solid #2456C4; padding: 10pt 14pt; margin: 16pt 0; white-space: pre-line; }
      h2 { font-size: 13pt; border-left: 3pt solid #2456C4; padding-left: 8pt; margin: 18pt 0 6pt; }
      p { margin: 0 0 8pt; white-space: pre-line; }
      .foot { margin-top: 24pt; padding-top: 8pt; border-top: 0.5pt solid #C6D0E0; color: #64748F; font-size: 8pt; }
    </style></head><body>
      <div class="brand">ADGRID</div>
      <h1>${r.periodType === 'weekly' ? '週次' : '月次'}レポート</h1>
      <div class="meta">クライアント: ${esc(r.clientName)} ／ 対象期間: ${jpDate(r.periodStart)}〜${jpDate(isoDate(periodEnd))} ／ 生成: ${r.createdAt.toLocaleDateString('ja-JP')}${r.mocked ? ' ／ ※AIモック結果 (デモ用)' : ''}</div>
      <div class="summary">${esc(r.result.executive_summary)}</div>
      ${sections
        .map((s) => `<h2>${esc(s.heading)}</h2><p>${esc(s.body)}</p>`)
        .join('')}
      <div class="foot">本レポートは ADGRID が実績データから自動生成しました。数値の根拠は管理画面のダッシュボードでご確認いただけます。</div>
    </body></html>`;
  }

  async toPdf(tenantId: string, reportId: string): Promise<Buffer> {
    const report = await this.load(tenantId, reportId);
    if (!this.browser) {
      try {
        this.browser = await chromium.launch({ headless: true });
      } catch (e) {
        this.logger.error(String(e));
        throw new AppError(
          HttpStatus.SERVICE_UNAVAILABLE,
          'PDF生成エンジンを起動できませんでした。',
          'apps/api で「pnpm exec playwright install chromium」を実行してから再試行してください。',
        );
      }
    }
    const page = await this.browser.newPage();
    try {
      await page.setContent(this.renderHtml(report), { waitUntil: 'load' });
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '18mm', bottom: '16mm', left: '16mm', right: '16mm' },
      });
      await this.trail.record({
        tenantId,
        action: 'report_export',
        resource: reportId,
        detail: { format: 'pdf' },
      });
      return Buffer.from(pdf);
    } finally {
      await page.close().catch(() => undefined);
    }
  }

  /* ---------------- PPTX (構造化JSON→スライド, F-04) ---------------- */

  async toPptx(tenantId: string, reportId: string): Promise<Buffer> {
    const r = await this.load(tenantId, reportId);
    const pptx = new PptxGenJS();
    pptx.defineLayout({ name: 'WIDE', width: 13.33, height: 7.5 });
    pptx.layout = 'WIDE';

    const INK = '131F35';
    const PRIMARY = '2456C4';
    const MUTED = '64748F';

    // 表紙
    const cover = pptx.addSlide();
    cover.addText('ADGRID', { x: 0.6, y: 0.5, fontSize: 14, bold: true, color: PRIMARY, charSpacing: 3 });
    cover.addText(`${r.periodType === 'weekly' ? '週次' : '月次'}レポート`, {
      x: 0.6, y: 2.4, w: 12, fontSize: 40, bold: true, color: INK,
    });
    cover.addText(
      `${r.clientName}\n対象期間: ${jpDate(r.periodStart)}〜 ／ 生成: ${r.createdAt.toLocaleDateString('ja-JP')}${r.mocked ? ' ／ ※AIモック結果 (デモ用)' : ''}`,
      { x: 0.6, y: 3.6, w: 12, fontSize: 14, color: MUTED, lineSpacing: 24 },
    );

    // サマリ
    const sum = pptx.addSlide();
    sum.addText('エグゼクティブサマリ', { x: 0.6, y: 0.4, fontSize: 22, bold: true, color: INK });
    sum.addShape('rect', { x: 0.6, y: 1.2, w: 0.08, h: 4.6, fill: { color: PRIMARY } });
    sum.addText(r.result.executive_summary, {
      x: 0.9, y: 1.2, w: 11.8, h: 4.6, fontSize: 16, color: INK, valign: 'top', lineSpacing: 30,
    });

    // 結果 → 要因 → 次のアクション
    const sections = [...r.result.sections].sort(
      (a, b) => (SECTION_ORDER[a.kind] ?? 9) - (SECTION_ORDER[b.kind] ?? 9),
    );
    for (const s of sections) {
      const slide = pptx.addSlide();
      slide.addText(s.heading, { x: 0.6, y: 0.4, w: 12, fontSize: 22, bold: true, color: INK });
      slide.addShape('line', { x: 0.6, y: 1.05, w: 12.1, h: 0, line: { color: PRIMARY, width: 2 } });
      slide.addText(s.body, {
        x: 0.6, y: 1.3, w: 12.1, h: 5.6, fontSize: 14, color: INK, valign: 'top', lineSpacing: 26,
      });
      slide.addText('ADGRID — 実績データから自動生成', {
        x: 0.6, y: 7.05, w: 12, fontSize: 8, color: MUTED,
      });
    }

    const buffer = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;
    await this.trail.record({
      tenantId,
      action: 'report_export',
      resource: reportId,
      detail: { format: 'pptx' },
    });
    return buffer;
  }

  async onModuleDestroy() {
    await this.browser?.close().catch(() => undefined);
    this.browser = null;
  }
}
