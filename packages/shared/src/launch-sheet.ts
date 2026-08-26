/**
 * 媒体別 入稿シート (F-58)。
 * プロジェクトの内容（ヒアリング・制作物・配信設定）を、各媒体の入稿仕様に合わせて
 * そのまま貼れる形に変換する。API入稿ができない媒体（LINE等）でも、手入力で
 * 「規定に合った最良の設定」を再現できるようにするのが目的。
 */
import type { Platform } from './platforms';
import { adSpecFor, type PlatformAdSpec, type TextSpec } from './platform-specs';

export interface SheetTextItem {
  text: string;
  len: number;
  /** 媒体の文字数上限に収まっているか */
  ok: boolean;
  /** 上限に収めるため文単位で短縮した (担当者の確認が必要) */
  shortened?: boolean;
}

export interface SheetField {
  label: string;
  /** そのままコピーして貼る値 */
  value: string;
  note?: string;
}

export interface LaunchSheetDto {
  platform: Platform;
  platformLabel: string;
  structure: string;
  campaignName: string;
  /** 予算・入札・期間など、管理画面にそのまま入れる値 */
  settings: SheetField[];
  headlines: SheetTextItem[];
  descriptions: SheetTextItem[];
  primaryTexts: SheetTextItem[];
  /** 検索媒体はキーワード、それ以外はオーディエンス方針 */
  keywords: string[];
  negatives: string[];
  targeting: string[];
  images: { label: string; size: string; ratio: string; note: string }[];
  bidding: string;
  tips: string[];
  checklist: string[];
  /** 入稿前に直すべき問題 */
  issues: string[];
  ready: boolean;
}

type Counter = (s: string) => number;

/** 文字数 (全角も1字)。Meta/LINE/TikTok 等、文字数で数える媒体向け */
function len(s: string): number {
  return [...s].length;
}

/**
 * 半角換算幅 (ASCII・半角カナ=1、全角=2)。Google/Yahoo検索の実仕様に合わせる。
 * これらの媒体は全角を2字と数えるため (見出し30 = 全角15字)、文字数で判定すると
 * 実制限の2倍まで「OK」になり、入稿時に審査で弾かれる
 */
function widthLen(s: string): number {
  let units = 0;
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 0;
    const isHalf = (code >= 0x20 && code <= 0x7e) || (code >= 0xff61 && code <= 0xff9f);
    units += isHalf ? 1 : 2;
  }
  return units;
}

/**
 * 上限に収まるよう文単位で短縮する。文の途中で切らない (意味が壊れるため)。
 * 1文目すら収まらない場合は null を返し、呼び出し側で扱いを決める。
 */
function shortenToFit(text: string, maxLen: number, count: Counter): string | null {
  if (count(text) <= maxLen) return text;
  // まず文単位で縮める (意味を壊さない)
  const sentences = text.split(/(?<=[。！？!?])/).map((x) => x.trim()).filter(Boolean);
  let acc = '';
  for (const sen of sentences) {
    const next = acc + sen;
    if (count(next) > maxLen) break;
    acc = next;
  }
  if (acc) return acc;
  // 見出しのような一文は文分割できない。貼り付け可能にするため文字単位で切り詰める。
  // 末尾に付ける「…」の実際の幅ぶんを空けておく (検索系では … は全角=幅2なので、
  // maxLen-1 だと … を足したとき1超過する)
  const ellipsisW = count('…');
  let hard = '';
  for (const ch of text) {
    if (count(hard + ch) > maxLen - ellipsisW) break;
    hard += ch;
  }
  return hard ? hard + '…' : null;
}

/**
 * 上限に収まる候補を、元の優先順を保って選ぶ。
 * 超過するものは文単位で短縮し、それでも収まらず任意項目(min=0)なら採用しない。
 * count は媒体ごとの字数の数え方 (検索系は幅、その他は文字数)。
 */
function fit(texts: string[], spec: TextSpec, count: Counter): SheetTextItem[] {
  const seen = new Set<string>();
  const out: SheetTextItem[] = [];
  for (const raw of texts) {
    const t = raw.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    if (count(t) <= spec.maxLen) {
      out.push({ text: t, len: count(t), ok: true });
    } else {
      const short = shortenToFit(t, spec.maxLen, count);
      // 短縮後のテキストも重複排除する (別々の元文が同じ短縮結果になることがある)
      if (short && !seen.has(short)) {
        seen.add(short);
        out.push({ text: short, len: count(short), ok: true, shortened: true });
      } else if (!short && spec.min > 0) {
        // 必須項目は空にできないため、超過のまま出して修正を促す
        out.push({ text: t, len: count(t), ok: false });
      }
      // 任意項目(min=0)で収まらないものは採用しない (無理に載せない)
    }
    if (out.length >= spec.max) break;
  }
  return out;
}

export interface LaunchSheetInput {
  platform: Platform;
  clientName: string;
  projectName: string;
  /** 制作物の見出し候補 (優先順) */
  headlines: string[];
  /** 制作物の説明文候補 */
  descriptions: string[];
  /** SNS向けの本文候補 */
  primaryTexts: string[];
  keywords: string[];
  negatives: string[];
  monthlyBudget: number;
  targetCpa: number | null;
  finalUrl: string;
  regions: string;
  audience: string;
  startDate: string | null;
  endDate: string | null;
}

function yen(n: number): string {
  return `¥${Math.round(n).toLocaleString('en-US')}`;
}

/** 検索系の媒体か (キーワードを使うか) */
function isSearch(platform: Platform): boolean {
  return platform === 'google_ads' || platform === 'yahoo_search' || platform === 'microsoft_ads';
}

export function buildLaunchSheet(input: LaunchSheetInput): LaunchSheetDto | null {
  const spec: PlatformAdSpec | null = adSpecFor(input.platform);
  if (!spec) return null;

  // 検索系(Google/Yahoo)は全角=2の幅で数える。他媒体は文字数
  const count: Counter = isSearch(input.platform) ? widthLen : len;
  const headlines = fit(input.headlines, spec.headline, count);
  const descriptions = fit(input.descriptions, spec.description, count);
  const primaryTexts = spec.primaryText ? fit(input.primaryTexts, spec.primaryText, count) : [];

  const daily = input.monthlyBudget > 0 ? input.monthlyBudget / 30.4 : 0;
  const search = isSearch(input.platform);

  const settings: SheetField[] = [
    { label: 'キャンペーン名', value: `${input.clientName} ${input.projectName}` },
    { label: '月予算', value: input.monthlyBudget > 0 ? yen(input.monthlyBudget) : '未設定' },
    { label: '日予算', value: daily > 0 ? yen(daily) : '未設定', note: '月予算 ÷ 30.4' },
    { label: '入札', value: input.targetCpa ? `目標CPA ${yen(input.targetCpa)}` : 'コンバージョン数の最大化', note: spec.bidding },
    { label: 'リンク先URL', value: input.finalUrl || '未設定' },
    { label: '配信地域', value: input.regions || '全国' },
    { label: '配信期間', value: `${input.startDate ?? '即時'} 〜 ${input.endDate ?? '無期限'}` },
  ];
  if (!search && input.audience) {
    settings.push({ label: 'オーディエンス', value: input.audience });
  }

  const issues: string[] = [];
  if (headlines.length < spec.headline.min) {
    issues.push(`見出しが${headlines.length}本です。${spec.label}では${spec.headline.min}本以上必要です。`);
  }
  if (descriptions.length < spec.description.min) {
    issues.push(`説明文が${descriptions.length}本です。${spec.description.min}本以上必要です。`);
  }
  if (spec.primaryText && primaryTexts.length < spec.primaryText.min) {
    issues.push(`本文が${primaryTexts.length}本です。${spec.primaryText.min}本以上必要です。`);
  }
  const all = [...headlines, ...descriptions, ...primaryTexts];
  const over = all.filter((t) => !t.ok);
  if (over.length > 0) {
    issues.push(`文字数超過が${over.length}件あります（該当行に印を付けています）。短く言い換えてください。`);
  }
  const shortened = all.filter((t) => t.shortened).length;
  if (shortened > 0) {
    issues.push(`${shortened}件を${spec.label}の文字数に合わせて自動短縮しました。意味が通るか確認してください。`);
  }
  if (!input.finalUrl) issues.push('リンク先URLが未設定です。');
  if (input.monthlyBudget <= 0) issues.push('月予算が未設定です。');
  if (search && input.keywords.length === 0) issues.push('キーワードが未設定です。「② 配信設定」でAI設計できます。');

  return {
    platform: input.platform,
    platformLabel: spec.label,
    structure: spec.structure,
    campaignName: `${input.clientName} ${input.projectName}`,
    settings,
    headlines,
    descriptions,
    primaryTexts,
    keywords: search ? input.keywords : [],
    negatives: search ? input.negatives : [],
    targeting: spec.targeting,
    images: spec.images,
    bidding: spec.bidding,
    tips: spec.tips,
    checklist: spec.checklist,
    issues,
    ready: issues.length === 0,
  };
}

/** 入稿シートを、管理画面に貼りやすいプレーンテキストに変換する */
export function sheetToText(s: LaunchSheetDto): string {
  const lines: string[] = [];
  lines.push(`■ ${s.platformLabel} 入稿シート`);
  lines.push(`構成: ${s.structure}`);
  lines.push('');
  lines.push('【設定】');
  for (const f of s.settings) lines.push(`${f.label}: ${f.value}`);
  lines.push('');
  if (s.headlines.length) {
    lines.push('【見出し】');
    s.headlines.forEach((h, i) => lines.push(`${i + 1}. ${h.text}  (${h.len}字${h.ok ? (h.shortened ? ' ※自動短縮' : '') : ' ※超過'})`));
    lines.push('');
  }
  if (s.primaryTexts.length) {
    lines.push('【本文】');
    s.primaryTexts.forEach((t, i) => lines.push(`${i + 1}. ${t.text}  (${t.len}字${t.ok ? (t.shortened ? ' ※自動短縮' : '') : ' ※超過'})`));
    lines.push('');
  }
  if (s.descriptions.length) {
    lines.push('【説明文】');
    s.descriptions.forEach((d, i) => lines.push(`${i + 1}. ${d.text}  (${d.len}字${d.ok ? (d.shortened ? ' ※自動短縮' : '') : ' ※超過'})`));
    lines.push('');
  }
  if (s.keywords.length) {
    lines.push('【キーワード】');
    lines.push(s.keywords.join('\n'));
    lines.push('');
  }
  if (s.negatives.length) {
    lines.push('【除外キーワード】');
    lines.push(s.negatives.join('\n'));
    lines.push('');
  }
  lines.push('【ターゲティング】');
  for (const t of s.targeting) lines.push(`・${t}`);
  lines.push('');
  if (s.images.length) {
    lines.push('【必要な画像】');
    for (const im of s.images) lines.push(`・${im.label}: ${im.size} (${im.ratio}) — ${im.note}`);
    lines.push('');
  }
  lines.push('【入稿前チェック】');
  for (const c of s.checklist) lines.push(`□ ${c}`);
  return lines.join('\n');
}
