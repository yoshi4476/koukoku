import { HttpStatus, Injectable } from '@nestjs/common';
import * as iconv from 'iconv-lite';
import type { CsvImportResultDto } from '@adgrid/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/errors';

/** 列名エイリアス辞書 (Google/Yahoo!/Meta の標準レポートの日英表記を吸収) */
const COLUMN_ALIASES: Record<string, string[]> = {
  date: ['日', '日付', 'date', 'day', '日別'],
  campaignName: ['キャンペーン', 'キャンペーン名', 'campaign', 'campaign name', 'キャンペーン名前'],
  cost: ['費用', 'コスト', '消化額', 'ご利用金額', '金額', 'cost', 'amount spent', '消費金額'],
  impressions: ['表示回数', 'インプレッション', 'インプレッション数', 'imp', 'impressions', 'インプレッション(imp)'],
  clicks: ['クリック数', 'クリック', 'clicks', 'リンクのクリック'],
  conversions: ['コンバージョン', 'コンバージョン数', 'cv', 'cv数', 'conversions', '結果'],
  conversionValue: ['コンバージョン値', '総コンバージョン価値', 'コンバージョン価値', 'conversion value', 'cv値', '売上', '購入コンバージョン値'],
};

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/["'\s　]/g, '');
}

function parseNumber(v: string | undefined): number {
  if (!v) return 0;
  const n = Number(String(v).replace(/[,¥\\"\s%]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function parseDate(v: string | undefined): Date | null {
  if (!v) return null;
  const m = String(v)
    .trim()
    .match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (!m) return null;
  // ローカル暦日をUTC深夜に固定 (metrics.service の日付規約と一致させる)
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 素朴だが引用符対応のCSV行パーサ */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

@Injectable()
export class CsvService {
  constructor(private readonly prisma: PrismaService) {}

  /** 文字コード判定: UTF-8で復号し、置換文字が多ければ Shift_JIS とみなす */
  private decode(buffer: Buffer): { text: string; encoding: 'utf8' | 'sjis' } {
    const utf8 = buffer.toString('utf8');
    const replacementCount = (utf8.match(/�/g) ?? []).length;
    if (replacementCount > Math.max(2, utf8.length / 1000)) {
      return { text: iconv.decode(buffer, 'Shift_JIS'), encoding: 'sjis' };
    }
    return { text: utf8.replace(/^﻿/, ''), encoding: 'utf8' };
  }

  async import(
    tenantId: string,
    adAccountId: string,
    fileName: string,
    buffer: Buffer,
  ): Promise<CsvImportResultDto> {
    const { text, encoding } = this.decode(buffer);
    const rows = parseCsv(text);
    if (rows.length < 2) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'CSVにデータ行がありません。',
        'ヘッダ行+1行以上のデータを含むCSVをアップロードしてください。',
      );
    }

    // ヘッダ行の特定 (先頭5行から最もエイリアス一致が多い行を選ぶ — 媒体レポートの前置き行対策)
    let headerIndex = 0;
    let bestScore = -1;
    let mapping: Record<string, number> = {};
    for (let i = 0; i < Math.min(rows.length, 5); i++) {
      const map: Record<string, number> = {};
      rows[i].forEach((h, col) => {
        const norm = normalizeHeader(h);
        for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
          if (map[field] === undefined && aliases.some((a) => normalizeHeader(a) === norm)) {
            map[field] = col;
          }
        }
      });
      const score = Object.keys(map).length;
      if (score > bestScore) {
        bestScore = score;
        headerIndex = i;
        mapping = map;
      }
    }

    const warnings: string[] = [];
    if (mapping.date === undefined || mapping.cost === undefined) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'CSVのフォーマットを判定できませんでした (日付・費用列が見つかりません)。',
        '媒体管理画面の標準レポート (日別×キャンペーン) 形式でエクスポートし直してください。',
      );
    }
    for (const opt of ['impressions', 'clicks', 'conversions'] as const) {
      if (mapping[opt] === undefined) warnings.push(`${opt} 列が見つからないため0として取り込みます。`);
    }

    const account = await this.prisma.withTenant(tenantId, (tx) =>
      tx.adAccount.findUnique({ where: { id: adAccountId } }),
    );
    if (!account) {
      throw new AppError(HttpStatus.NOT_FOUND, '取込先アカウントが見つかりません。', 'アカウントを選び直してください。');
    }

    // 集計: 日付×キャンペーンで合算
    const agg = new Map<
      string,
      { date: Date; campaignName: string; cost: number; impressions: number; clicks: number; conversions: number; conversionValue: number }
    >();
    let errorRows = 0;
    const dataRows = rows.slice(headerIndex + 1);
    for (const r of dataRows) {
      const date = parseDate(r[mapping.date]);
      if (!date) {
        errorRows++;
        continue;
      }
      const campaignName = mapping.campaignName !== undefined ? (r[mapping.campaignName] ?? '').trim() : '';
      const key = `${date.toISOString()}|${campaignName}`;
      const cur = agg.get(key) ?? {
        date,
        campaignName,
        cost: 0,
        impressions: 0,
        clicks: 0,
        conversions: 0,
        conversionValue: 0,
      };
      cur.cost += parseNumber(r[mapping.cost]);
      cur.impressions += mapping.impressions !== undefined ? parseNumber(r[mapping.impressions]) : 0;
      cur.clicks += mapping.clicks !== undefined ? parseNumber(r[mapping.clicks]) : 0;
      cur.conversions += mapping.conversions !== undefined ? parseNumber(r[mapping.conversions]) : 0;
      cur.conversionValue += mapping.conversionValue !== undefined ? parseNumber(r[mapping.conversionValue]) : 0;
      agg.set(key, cur);
    }

    const entries = [...agg.values()];
    if (entries.length === 0) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        '取り込める行がありませんでした (日付を解釈できません)。',
        '日付列が YYYY/MM/DD または YYYY-MM-DD 形式か確認してください。',
      );
    }
    const minDate = new Date(Math.min(...entries.map((e) => e.date.getTime())));
    const maxDate = new Date(Math.max(...entries.map((e) => e.date.getTime())));

    const inserted = await this.prisma.withTenant(tenantId, async (tx) => {
      // 同一期間の既存CSV由来データを洗い替え (再取込に対応)
      await tx.factAdPerformance.deleteMany({
        where: { adAccountId, date: { gte: minDate, lte: maxDate } },
      });
      const created = await tx.factAdPerformance.createMany({
        data: entries.map((e) => ({
          date: e.date,
          tenantId,
          adAccountId,
          platform: account.platform,
          campaignId: e.campaignName ? `csv:${e.campaignName}` : '',
          campaignName: e.campaignName,
          adgroupId: '',
          adId: '',
          impressions: BigInt(Math.round(e.impressions)),
          clicks: BigInt(Math.round(e.clicks)),
          cost: +e.cost.toFixed(2),
          conversions: +e.conversions.toFixed(1),
          conversionValue: +e.conversionValue.toFixed(2),
          currency: account.currency,
          extra: {},
        })),
      });
      return created.count;
    });

    const detectedFormat = bestScore >= 5 ? 'media-standard-jp' : 'generic-csv';
    const importRow = await this.prisma.withTenant(tenantId, (tx) =>
      tx.csvImport.create({
        data: {
          tenantId,
          adAccountId,
          fileName,
          detectedFormat,
          encoding,
          mapping: Object.fromEntries(Object.entries(mapping).map(([k, v]) => [k, String(v)])),
          rowCount: dataRows.length,
          insertedRows: inserted,
          errorRows,
        },
      }),
    );

    return {
      importId: importRow.id,
      detectedFormat,
      encoding,
      rowCount: dataRows.length,
      insertedRows: inserted,
      errorRows,
      mapping: Object.fromEntries(Object.entries(mapping).map(([k, v]) => [k, String(v)])),
      warnings,
    };
  }
}
