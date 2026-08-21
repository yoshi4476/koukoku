/**
 * 業種モード (業種別最適化)。
 * 相場 (benchmarks.ts) に加え、業種ごとの「広告文の訴求軸」「NG表現(規制)」
 * 「診断の重点」「CVの呼称(用語)」をまとめ、診断・広告文・画面表示を業種最適化する。
 * 注意: NG表現は代表例。実運用では最新の各業法・媒体審査基準を一次確認すること。
 */
import { benchmarkFor, type IndustryBenchmark } from './benchmarks';
import type { AppealAxis } from './ai';

/** 診断カテゴリ (audit の category と一致) */
export type DiagnosisCategory = 'measurement' | 'budget' | 'structure' | 'bidding' | 'creative';

export interface IndustryProfile {
  code: string;
  label: string;
  /** この業種で効きやすい訴求軸 (広告文の既定順) */
  appealAxes: AppealAxis[];
  /** 業種特有のNG/要注意表現 (広告文スキャンに加える。法規制ベース) */
  ngWords: string[];
  /** 診断で重点的に見るカテゴリ (指摘の並びで優先) */
  diagnosisFocus: DiagnosisCategory[];
  /** CVの呼称 (画面用語)。例 EC=購入 / 人材=応募 */
  cvLabel: string;
  /** 運用ワンポイント (業種の勘所) */
  tip: string;
}

export const INDUSTRY_PROFILES: Record<string, IndustryProfile> = {
  ec: {
    code: 'ec',
    label: 'EC・物販',
    appealAxes: ['価格・オファー', '社会的証明', '緊急性・限定', '便益'],
    ngWords: ['日本一', '世界一', '最安値', '完全'],
    diagnosisFocus: ['creative', 'bidding'],
    cvLabel: '購入',
    tip: '送料無料・レビュー・在庫や期間限定が刺さりやすい。ショッピング広告の商品フィードとROASを重視。',
  },
  beauty: {
    code: 'beauty',
    label: '美容・サロン',
    appealAxes: ['社会的証明', '便益', '権威', '新規性'],
    ngWords: ['シミが消える', '完全に', '絶対', '即効', '永久', '治る', '若返る'],
    diagnosisFocus: ['creative', 'measurement'],
    cvLabel: '予約・購入',
    tip: '効果効能の断定は薬機法NG。体験談・ビフォーアフターは表現ルールに沿って。来店予約の計測を最優先。',
  },
  saas: {
    code: 'saas',
    label: 'SaaS・IT',
    appealAxes: ['便益', '簡便性', '社会的証明', '損失回避'],
    ngWords: ['完全無料', '絶対', '必ず'],
    diagnosisFocus: ['structure', 'measurement'],
    cvLabel: '問い合わせ・申込',
    tip: '無料トライアル・導入事例・ROIが効く。指名/一般KWを分け、フォーム完了までの計測を整備。',
  },
  finance: {
    code: 'finance',
    label: '金融・保険',
    appealAxes: ['権威', '損失回避', '社会的証明'],
    ngWords: ['元本保証', '必ず儲かる', '絶対', 'リスクなし', '確実'],
    diagnosisFocus: ['measurement', 'budget'],
    cvLabel: '申込・見積',
    tip: '誇大・断定は金商法/景表法で厳格。数値には根拠と注記を。獲得単価が高く計測精度が命。',
  },
  hr: {
    code: 'hr',
    label: '人材・採用',
    appealAxes: ['便益', '社会的証明', '緊急性・限定'],
    ngWords: ['性別', '年齢不問以外の年齢指定', '高収入確約', '絶対に稼げる'],
    diagnosisFocus: ['creative', 'structure'],
    cvLabel: '応募',
    tip: '募集条件の明記が刺さる。性別・年齢の限定表現は職安法NG。応募単価とエントリー完了率を重視。',
  },
  realestate: {
    code: 'realestate',
    label: '不動産',
    appealAxes: ['便益', '権威', '社会的証明', '緊急性・限定'],
    ngWords: ['完全', '日本一', '最高級', '絶対', '格安'],
    diagnosisFocus: ['creative', 'budget'],
    cvLabel: '資料請求・来場',
    tip: '「完全」「最高級」等の最上級表現は不当表示に注意。エリア×間取りのKW設計と来場計測を。',
  },
  education: {
    code: 'education',
    label: '教育・スクール',
    appealAxes: ['便益', '社会的証明', '権威', '新規性'],
    ngWords: ['必ず合格', '100%', '絶対'],
    diagnosisFocus: ['creative', 'structure'],
    cvLabel: '資料請求・体験申込',
    tip: '合格実績・体験談が効く。「必ず合格」等の保証表現は避ける。体験申込のCV計測を重視。',
  },
  other: {
    code: 'other',
    label: 'その他',
    appealAxes: ['便益', '社会的証明', '損失回避', '簡便性'],
    ngWords: ['絶対', '必ず', '日本一'],
    diagnosisFocus: ['measurement', 'budget'],
    cvLabel: 'コンバージョン',
    tip: '指名KWと一般KWを分け、CV計測を最優先で整える。相場比較で優先改善点を特定。',
  },
};

export function industryProfileFor(industryCode: string): IndustryProfile {
  return INDUSTRY_PROFILES[industryCode] ?? INDUSTRY_PROFILES.other;
}

/** 業種モードの表示用に相場+プロファイルをまとめて返す */
export function industryModeFor(industryCode: string): {
  profile: IndustryProfile;
  benchmark: IndustryBenchmark;
} {
  return { profile: industryProfileFor(industryCode), benchmark: benchmarkFor(industryCode) };
}
