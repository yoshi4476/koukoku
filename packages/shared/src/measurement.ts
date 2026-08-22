/**
 * 計測基盤 (GA4/CAPI) のヘルス評価 (F-46)。
 * CV計測地点・GA4・サーバーサイド計測(CAPI/拡張CV)・ピクセルの設定状況から、
 * 「計測がどれだけ信頼できるか」をスコア化する。iOS/クッキー制限下では
 * サーバーサイド計測の有無が精度を大きく左右するため重み付けを厚くする。
 */

export interface MeasurementConfigDto {
  clientId: string;
  ga4MeasurementId: string;
  ga4PropertyId: string;
  metaPixelId: string;
  serverSideEnabled: boolean;
  enhancedConversions: boolean;
  note: string;
  updatedAt: string | null;
  /** サーバー側でCAPI送信の鍵(META_CAPI_ACCESS_TOKEN等)が設定済みか */
  serverKeysReady: boolean;
}

export interface MeasurementHealthItem {
  key: string;
  label: string;
  ok: boolean;
  weight: number;
  detail: string;
}

export interface MeasurementHealthDto {
  score: number; // 0-100
  grade: 'good' | 'warn' | 'bad';
  items: MeasurementHealthItem[];
  summary: string;
}

export interface MeasurementHealthInput {
  hasCvPoint: boolean;
  hasGa4: boolean;
  hasPixel: boolean;
  serverSide: boolean;
  enhancedConversions: boolean;
  serverKeysReady: boolean;
}

export function measurementHealth(input: MeasurementHealthInput): MeasurementHealthDto {
  const items: MeasurementHealthItem[] = [
    {
      key: 'cv_point', label: 'CV計測地点の設定', ok: input.hasCvPoint, weight: 25,
      detail: input.hasCvPoint ? '計測するCV地点が設定されています。' : '配信設定でCV地点(購入完了/資料請求など)を指定してください。最適化の起点です。',
    },
    {
      key: 'server_side', label: 'サーバーサイド計測 (CAPI / 拡張CV)', ok: input.serverSide && input.serverKeysReady, weight: 30,
      detail: input.serverSide && input.serverKeysReady
        ? 'サーバー側でCV送信済み。iOS/クッキー制限に強い計測です。'
        : !input.serverSide
          ? '未設定。iOSやクッキー制限でCVが2〜4割欠落します。CAPI/拡張CVの有効化を強く推奨。'
          : '設定はONですが送信鍵(アクセストークン)が未設定です。.env に鍵を設定してください。',
    },
    {
      key: 'ga4', label: 'GA4 連携', ok: input.hasGa4, weight: 20,
      detail: input.hasGa4 ? 'GA4測定IDが設定されています。' : 'GA4測定ID(G-XXXX)を設定すると、行動データとCVを統合分析できます。',
    },
    {
      key: 'pixel', label: '媒体ピクセル (Meta等)', ok: input.hasPixel, weight: 15,
      detail: input.hasPixel ? 'ピクセルIDが設定されています。' : 'Metaピクセル等を設定すると媒体側の最適化とリタゲが効きます。',
    },
    {
      key: 'enhanced', label: '拡張コンバージョン', ok: input.enhancedConversions, weight: 10,
      detail: input.enhancedConversions ? '拡張コンバージョン有効。計測の取りこぼしを補完します。' : '拡張コンバージョンを有効化すると計測精度が上がります。',
    },
  ];
  const score = items.reduce((s, i) => s + (i.ok ? i.weight : 0), 0);
  const grade: MeasurementHealthDto['grade'] = score >= 80 ? 'good' : score >= 50 ? 'warn' : 'bad';
  const summary =
    grade === 'good'
      ? '計測は信頼できる状態です。この数値をもとに安心して最適化できます。'
      : grade === 'warn'
        ? '計測に穴があります。特にサーバーサイド計測を整えると、最適化の精度が上がります。'
        : '計測が不十分です。CV計測地点とサーバーサイド計測(CAPI/拡張CV)をまず整えてください。数値の信頼性が低い状態です。';
  return { score, grade, items, summary };
}
