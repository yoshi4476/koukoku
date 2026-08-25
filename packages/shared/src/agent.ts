import type { ProjectGoal, ProjectSettings } from './api';

/**
 * AI運用エージェント (F-43)。1つの指示(自然言語)から、AIが最適な順序で
 * 目標→予算→配信設定→制作物→プレビュー→公開準備まで一気通貫で組み立てる。
 * 指示の解釈は ANTHROPIC_API_KEY 設定時は実Claude、未設定時は決定的パーサでフォールバック。
 */

export interface AgentHints {
  budget?: number | null;
  targetCv?: number | null;
  targetCpa?: number | null;
  regions?: string | null;
  gender?: 'all' | 'male' | 'female' | null;
  ageRange?: string | null;
  goalHint?: ProjectGoal | null;
}

function toNum(s: string): number {
  return Number(s.replace(/[,，]/g, ''));
}

/** 自然言語の指示から予算・目標・ターゲティングのヒントを決定的に抽出する */
export function parseInstruction(text: string): AgentHints {
  const t = (text ?? '').trim();
  const hints: AgentHints = {};

  // 予算: 「30万」「30万円」「予算50万」「月500,000円」。
  // 「CPA4000円」等をCPAと誤認しないよう、円指定は予算/月の文脈がある時だけ採用する。
  const man = t.match(/(\d[\d,]*(?:\.\d+)?)\s*万/);
  const budgetYen = t.match(/(?:予算|月|ひと月|マンスリー)[はをにで:：\s]*(\d[\d,]{3,})\s*円/);
  if (man) hints.budget = Math.round(toNum(man[1]) * 10000);
  else if (budgetYen) hints.budget = toNum(budgetYen[1]);

  // 目標CV: 「CV100」「100件」「月100件」
  const cv = t.match(/CV\s*[:：]?\s*(\d[\d,]*)/i) || t.match(/(\d[\d,]*)\s*件/);
  if (cv) hints.targetCv = toNum(cv[1]);

  // 目標CPA: 「CPA4000」「CPA 4,000円」
  const cpa = t.match(/CPA\s*[:：]?\s*(\d[\d,]*)/i);
  if (cpa) hints.targetCpa = toNum(cpa[1]);

  // 地域
  const regions = (t.match(/(全国|首都圏|関東|関西|東京|大阪|名古屋|福岡|札幌|横浜|京都|神戸)/g) || []);
  if (regions.length) hints.regions = [...new Set(regions)].join('・');

  // 性別
  if (/女性/.test(t)) hints.gender = 'female';
  else if (/男性/.test(t)) hints.gender = 'male';

  // 年齢
  const age = t.match(/(\d{2})\s*[-〜~ー]\s*(\d{2})\s*歳/);
  if (age) hints.ageRange = `${age[1]}-${age[2]}`;

  // 目的
  if (/(来店|予約|来場)/.test(t)) hints.goalHint = 'store';
  else if (/(認知|ブランディング|リーチ)/.test(t)) hints.goalHint = 'awareness';
  else if (/(誘導|サイト流入|アクセス)/.test(t)) hints.goalHint = 'traffic';
  else if (/(購入|獲得|問い合わせ|資料請求|申込|応募|CV|コンバージョン)/.test(t)) hints.goalHint = 'conversion';

  return hints;
}

export interface AgentStep {
  key: string;
  title: string;
  detail: string;
  /** todo = 実行済みだが、担当者の操作がまだ残っている段階 */
  status: 'done' | 'skip' | 'todo';
}

export interface AgentRunDto {
  mocked: boolean;
  instruction: string;
  /** 解釈したゴール */
  goal: ProjectGoal;
  steps: AgentStep[];
  /** 反映した配信設定 */
  appliedSettings: ProjectSettings;
  /** 生成・登録した制作物のタイトル */
  createdAssetTitles: string[];
  /** 媒体配分の要約 (媒体名: 月予算) */
  mediaPlan: { platformLabel: string; monthlyBudget: number; sharePct: number }[];
  /** 想定成果 */
  expectedCv: number;
  /** 公開準備が整ったか (最終確認→公開へ) */
  readyToPublish: boolean;
}
