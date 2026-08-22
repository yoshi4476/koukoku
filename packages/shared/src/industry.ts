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
  apparel: {
    code: 'apparel',
    label: 'アパレル・ファッション',
    appealAxes: ['新規性', '社会的証明', '価格・オファー', '緊急性・限定'],
    ngWords: ['完全', '日本一', '最高級'],
    diagnosisFocus: ['creative', 'bidding'],
    cvLabel: '購入',
    tip: '新作・セール・スタイリング訴求が効く。ショッピング/動画のクリエイティブを高頻度で回す。',
  },
  food: {
    code: 'food',
    label: '飲食・グルメ',
    appealAxes: ['社会的証明', '便益', '緊急性・限定', '価格・オファー'],
    ngWords: ['日本一', '最高', '完全', '絶対'],
    diagnosisFocus: ['creative', 'budget'],
    cvLabel: '予約・来店',
    tip: 'クーポン・限定メニュー・口コミが強い。ランチ/ディナーの時間帯配信と地域指定を最適化。',
  },
  app: {
    code: 'app',
    label: 'アプリ・ゲーム',
    appealAxes: ['新規性', '便益', '社会的証明', '簡便性'],
    ngWords: ['絶対', '必ず', '完全無料'],
    diagnosisFocus: ['measurement', 'creative'],
    cvLabel: 'インストール',
    tip: 'CPI・継続率が命。動画クリエイティブのA/Bと計測(SKAN/イベント計測)を最優先。',
  },
  btob: {
    code: 'btob',
    label: 'BtoB・製造/法人',
    appealAxes: ['便益', '権威', '損失回避', '社会的証明'],
    ngWords: ['絶対', '必ず', '完全', '日本一'],
    diagnosisFocus: ['structure', 'measurement'],
    cvLabel: '問い合わせ・資料請求',
    tip: 'ホワイトペーパー・導入事例が効く。長い検討フローを想定し、リード質と獲得単価を計測。',
  },
  bridal: {
    code: 'bridal',
    label: 'ブライダル',
    appealAxes: ['便益', '社会的証明', '権威', '緊急性・限定'],
    ngWords: ['完全', '日本一', '最高', '絶対'],
    diagnosisFocus: ['creative', 'budget'],
    cvLabel: '来館・相談予約',
    tip: 'フェア誘導・特典・体験談が効く。検討期間が長いため指名/一般KWを分離し来館計測を重視。',
  },
  automotive: {
    code: 'automotive',
    label: '自動車',
    appealAxes: ['便益', '権威', '社会的証明', '価格・オファー'],
    ngWords: ['日本一', '完全', '最安', '絶対'],
    diagnosisFocus: ['creative', 'budget'],
    cvLabel: '見積・来店予約',
    tip: '試乗予約・残価・キャンペーンが効く。車種×エリアのKW設計と来店計測を。',
  },
  medical: {
    code: 'medical',
    label: '医療・クリニック',
    appealAxes: ['権威', '便益', '社会的証明'],
    ngWords: ['必ず治る', '絶対', '100%', '安全', '副作用なし', '最高'],
    diagnosisFocus: ['measurement', 'creative'],
    cvLabel: '予約・問診',
    tip: '医療広告ガイドライン厳守。効果の断定・ビフォーアフター規制に注意。予約計測を重視。',
  },
  travel: {
    code: 'travel',
    label: '旅行・観光',
    appealAxes: ['便益', '緊急性・限定', '社会的証明', '価格・オファー'],
    ngWords: ['絶対', '完全', '日本一'],
    diagnosisFocus: ['creative', 'bidding'],
    cvLabel: '予約',
    tip: '季節性と早割・限定が効く。閑散/繁忙期で予算配分を大きく変え、地域・期間指定を細かく。',
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
  clinic_beauty: {
    code: 'clinic_beauty',
    label: '美容クリニック・医療脱毛',
    appealAxes: ['社会的証明', '権威', '便益', '緊急性・限定'],
    ngWords: ['必ず', '絶対', '100%', '完全に', '永久', '痛くない', '安全'],
    diagnosisFocus: ['creative', 'measurement'],
    cvLabel: 'カウンセリング予約',
    tip: '医療広告ガイドライン+薬機法を厳守。ビフォーアフター・体験談は要件遵守。無料カウンセリング導線と予約計測を最優先。',
  },
  fitness: {
    code: 'fitness',
    label: 'フィットネス・ジム',
    appealAxes: ['便益', '社会的証明', '緊急性・限定', '価格・オファー'],
    ngWords: ['必ず痩せる', '絶対', '100%', '完全'],
    diagnosisFocus: ['creative', 'budget'],
    cvLabel: '体験・見学予約',
    tip: '入会キャンペーン・無料体験の導線が効く。地域×目的(ダイエット/筋トレ/暗闇)のKW設計を。',
  },
  legal: {
    code: 'legal',
    label: '士業 (弁護士・税理士)',
    appealAxes: ['権威', '便益', '社会的証明'],
    ngWords: ['必ず勝てる', '絶対', '100%', '完全'],
    diagnosisFocus: ['measurement', 'structure'],
    cvLabel: '無料相談予約',
    tip: '無料相談・実績・専門分野の明示が効く。誇大・断定は懲戒/景表法リスク。相談種別ごとのKW設計を。',
  },
  repair: {
    code: 'repair',
    label: '整体・整骨院・鍼灸',
    appealAxes: ['便益', '社会的証明', '緊急性・限定'],
    ngWords: ['治る', '完治', '必ず', '絶対', '医学的効果'],
    diagnosisFocus: ['creative', 'budget'],
    cvLabel: '来院予約',
    tip: '症状別の訴求と口コミが効く。医療的効果の断定は柔整・あはき法で不可。地域×症状のKW設計を。',
  },
  reform: {
    code: 'reform',
    label: 'リフォーム・工務店',
    appealAxes: ['便益', '権威', '社会的証明', '価格・オファー'],
    ngWords: ['完全', '最安', '日本一', '絶対'],
    diagnosisFocus: ['creative', 'budget'],
    cvLabel: '見積・現地調査',
    tip: '施工事例・保証・補助金の訴求が効く。エリア×工事種別(外壁/水回り/全面)のKW設計を。',
  },
  pet: {
    code: 'pet',
    label: 'ペット',
    appealAxes: ['便益', '社会的証明', '新規性', '価格・オファー'],
    ngWords: ['完全', '絶対', '日本一'],
    diagnosisFocus: ['creative', 'bidding'],
    cvLabel: '購入・問い合わせ',
    tip: '写真・動画のかわいさとレビューが強い。定期購入・初回オファーの相性が良い。',
  },
  moving: {
    code: 'moving',
    label: '引越し・生活サービス',
    appealAxes: ['価格・オファー', '便益', '緊急性・限定', '社会的証明'],
    ngWords: ['最安', '日本一', '完全', '絶対'],
    diagnosisFocus: ['creative', 'budget'],
    cvLabel: '見積・予約',
    tip: '一括見積・繁忙期の価格訴求が効く。時期(3-4月)で予算を大きく変える。エリア×サービスのKW設計を。',
  },
  funeral: {
    code: 'funeral',
    label: '冠婚葬祭・葬儀',
    appealAxes: ['便益', '権威', '社会的証明'],
    ngWords: ['完全', '最安', '日本一', '絶対'],
    diagnosisFocus: ['measurement', 'creative'],
    cvLabel: '資料請求・相談',
    tip: '緊急性と安心・明朗会計が効く。24時間対応・事前相談の明示。地域×プランのKW設計を。',
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
