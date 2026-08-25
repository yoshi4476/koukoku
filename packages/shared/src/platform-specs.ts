/**
 * 媒体別の入稿仕様 (F-58)。
 * 媒体ごとに見出し・説明文の文字数や本数、画像比率、ターゲティングの考え方が違う。
 * ここを一元化して、どの媒体でも「規定に合った状態」で入稿シートを出せるようにする。
 *
 * 数値は各媒体の公開仕様に基づくが、媒体側の変更で変わりうる。
 * 実際の入稿でエラーが出た場合は、その媒体のヘルプを確認してここを更新すること。
 */
import type { Platform } from './platforms';

export interface TextSpec {
  /** 全角=1字として数える上限 (媒体表記に合わせる) */
  maxLen: number;
  /** 必須本数 */
  min: number;
  /** 登録できる最大本数 */
  max: number;
  /** 推奨本数 (機械学習が回りやすい本数) */
  recommended: number;
}

export interface ImageSpec {
  label: string;
  /** 推奨サイズ (px) */
  size: string;
  ratio: string;
  note: string;
}

export interface PlatformAdSpec {
  platform: Platform;
  label: string;
  /** 入稿の単位 (媒体の呼称に合わせる) */
  structure: string;
  headline: TextSpec;
  description: TextSpec;
  /** 媒体によっては本文(primary text)が別枠 */
  primaryText?: TextSpec;
  images: ImageSpec[];
  /** ターゲティングの考え方 (媒体ごとに効くレバーが違う) */
  targeting: string[];
  /** 入札・最適化の推奨 */
  bidding: string;
  /** 成果を出すための媒体固有の勘所 */
  tips: string[];
  /** 入稿前に必ず確認する項目 */
  checklist: string[];
}

const JP_TIPS_SEARCH = [
  '検索広告は「発注意図の強いキーワード」で成果が決まる。情報収集の語は除外キーワードに回す',
  '広告文にキーワードを含めると品質スコアが上がり、同じ入札でも表示されやすくなる',
];

export const PLATFORM_AD_SPECS: Partial<Record<Platform, PlatformAdSpec>> = {
  google_ads: {
    platform: 'google_ads',
    label: 'Google広告（検索）',
    structure: 'キャンペーン → 広告グループ → キーワード + レスポンシブ検索広告',
    headline: { maxLen: 30, min: 3, max: 15, recommended: 12 },
    description: { maxLen: 90, min: 2, max: 4, recommended: 4 },
    images: [
      { label: 'ロゴ', size: '1200×1200', ratio: '1:1', note: 'P-MAX・ディスプレイ拡張で使用' },
      { label: '横長画像', size: '1200×628', ratio: '1.91:1', note: 'ディスプレイ面での主役' },
    ],
    targeting: [
      'キーワード（フレーズ一致を基本。完全一致は機会損失、部分一致は無駄クリックが増える）',
      '地域（商圏がある業種は市区町村まで絞ると CPA が大きく下がる）',
      '除外キーワード（求人・無料・やり方 などは必ず除外）',
    ],
    bidding: 'コンバージョン数の最大化で開始し、CV が月30件を超えたら目標CPAへ切り替える',
    tips: [...JP_TIPS_SEARCH, '見出しは12本以上入れると組み合わせ最適化が働きやすい'],
    checklist: [
      '見出し3本以上・説明文2本以上（未達だと入稿できない）',
      'リンク先URLがスマホで3秒以内に開くか',
      'コンバージョン計測タグがサンクスページに入っているか',
      '除外キーワードを登録したか',
    ],
  },

  yahoo_search: {
    platform: 'yahoo_search',
    label: 'Yahoo!検索広告',
    structure: 'キャンペーン → 広告グループ → キーワード + レスポンシブ検索広告',
    headline: { maxLen: 30, min: 3, max: 15, recommended: 10 },
    description: { maxLen: 90, min: 2, max: 4, recommended: 4 },
    images: [],
    targeting: [
      'キーワード（Googleと同じ設計で流用できるが、検索ボリュームは少なめ）',
      '地域・曜日時間帯',
      '年齢・性別（Googleより指定の効きが強い場面がある）',
    ],
    bidding: 'コンバージョン最適化。Googleより単価が安いことが多く、同じ予算でCVを拾える場合がある',
    tips: [
      ...JP_TIPS_SEARCH,
      '利用者はPC・シニア層の比率がGoogleより高い。訴求を少し丁寧・安心寄りにすると効く',
    ],
    checklist: ['見出し3本以上・説明文2本以上', 'Googleのキーワードをそのまま流用できるか確認', '審査ガイドラインがGoogleより厳しい表現がないか'],
  },

  meta: {
    platform: 'meta',
    label: 'Meta広告（Facebook/Instagram）',
    structure: 'キャンペーン → 広告セット（ターゲティング・予算） → 広告（クリエイティブ）',
    headline: { maxLen: 40, min: 1, max: 5, recommended: 5 },
    description: { maxLen: 30, min: 0, max: 5, recommended: 2 },
    primaryText: { maxLen: 125, min: 1, max: 5, recommended: 5 },
    images: [
      { label: 'フィード（正方形）', size: '1080×1080', ratio: '1:1', note: '最も汎用。まずこれを用意' },
      { label: 'フィード（縦長）', size: '1080×1350', ratio: '4:5', note: 'フィードの占有面積が大きく成果が出やすい' },
      { label: 'ストーリーズ/リール', size: '1080×1920', ratio: '9:16', note: '上下15%は文字を置かない（UIに隠れる）' },
    ],
    targeting: [
      'オーディエンス（詳細ターゲティングは絞りすぎない。学習が回らずCPAが悪化する）',
      'カスタムオーディエンス（サイト訪問者・顧客リスト）＝最も効く',
      '類似オーディエンス 1%（カスタムオーディエンスが1,000件以上あれば強力）',
      '配置は「自動配置」を基本にする（手動で絞ると単価が上がる）',
    ],
    bidding: 'コンバージョン最適化。広告セットあたり週50CVを目標に予算を集約する（分散させると学習が終わらない）',
    tips: [
      '本文の冒頭125字で勝負が決まる。最初の1行に結論を置く',
      '画像内の文字は少なめに（多いと配信が抑制されることがある）',
      'Conversions API（CAPI）併用でiOS環境のCV取りこぼしを防ぐ',
      '広告セットを増やしすぎない。予算を集約したほうが学習が早く安定する',
    ],
    checklist: [
      '本文・見出し・画像が各比率で用意できているか',
      'Metaピクセル＋CAPIが動いているか（イベントマネージャーで受信確認）',
      'カスタムオーディエンスを作成したか',
      '画像内テキストが多すぎないか',
    ],
  },

  line_ads: {
    platform: 'line_ads',
    label: 'LINE広告',
    structure: 'キャンペーン → 広告グループ（ターゲティング） → 広告',
    headline: { maxLen: 20, min: 1, max: 5, recommended: 5 },
    description: { maxLen: 75, min: 1, max: 5, recommended: 3 },
    images: [
      { label: 'Card（横長）', size: '1200×628', ratio: '1.91:1', note: 'トークリスト・LINE NEWS などの主要面' },
      { label: 'Square（正方形）', size: '1080×1080', ratio: '1:1', note: 'タイムライン向け' },
      { label: '小型画像', size: '600×400', ratio: '3:2', note: 'トークリスト最上部' },
    ],
    targeting: [
      'みなし属性（年齢・性別・地域・興味関心）',
      'オーディエンス（ウェブ訪問・友だち・顧客データ）',
      '類似オーディエンス（配信量を伸ばすときに有効）',
    ],
    bidding: 'CV最適化（自動入札）。国内リーチが最大級のため、認知〜獲得まで振れ幅が大きい',
    tips: [
      '生活者の距離が近い媒体。売り込み感が強いと嫌われる。役立つ情報・お得の提示が効く',
      '画像はテキストを大きく1メッセージに絞る（トークリストでは小さく表示される）',
      '友だち追加を目的にすると、その後のメッセージ配信で継続的に接触できる',
    ],
    checklist: [
      'LINE Tag（計測タグ）を設置したか',
      '画像を3比率とも用意したか',
      '審査で止まりやすい表現（誇大・煽り）がないか',
      'API入稿は認定パートナー限定のため、管理画面で入稿する',
    ],
  },

  yahoo_display: {
    platform: 'yahoo_display',
    label: 'Yahoo!ディスプレイ広告',
    structure: 'キャンペーン → 広告グループ → 広告（レスポンシブ）',
    headline: { maxLen: 15, min: 1, max: 5, recommended: 5 },
    description: { maxLen: 90, min: 1, max: 5, recommended: 3 },
    images: [
      { label: '横長', size: '1200×628', ratio: '1.91:1', note: '主要面' },
      { label: '正方形', size: '300×300', ratio: '1:1', note: '小型枠' },
    ],
    targeting: ['サーチターゲティング（検索履歴）＝ディスプレイでも意図が拾える', 'サイトリターゲティング', 'オーディエンスカテゴリー'],
    bidding: 'コンバージョン最適化。まずはリターゲティングから始めるとCPAが安定する',
    tips: ['サーチターゲティングはYahoo!特有で強力。検索キーワードをそのまま活かせる'],
    checklist: ['サイトジェネラルタグを設置したか', '画像を主要比率で用意したか'],
  },

  tiktok: {
    platform: 'tiktok',
    label: 'TikTok広告',
    structure: 'キャンペーン → 広告グループ → 広告（動画）',
    headline: { maxLen: 40, min: 1, max: 5, recommended: 5 },
    description: { maxLen: 100, min: 1, max: 5, recommended: 3 },
    images: [{ label: '動画（縦型）', size: '1080×1920', ratio: '9:16', note: '9〜15秒推奨。冒頭2秒で掴む' }],
    targeting: ['興味関心・行動', 'カスタムオーディエンス', '年齢は広めに取る（絞ると単価が跳ねる）'],
    bidding: 'コンバージョン最適化。動画の入れ替え頻度が成果を左右する',
    tips: ['広告っぽさを消す。UGC風・実演・before/after が効く', '冒頭2秒でスクロールを止める要素を置く'],
    checklist: ['縦型動画があるか', 'TikTok Pixel を設置したか', '音声ありでも成立するか'],
  },
};

/** 入稿仕様が定義されている媒体か */
export function hasAdSpec(platform: Platform): boolean {
  return !!PLATFORM_AD_SPECS[platform];
}

export function adSpecFor(platform: Platform): PlatformAdSpec | null {
  return PLATFORM_AD_SPECS[platform] ?? null;
}
