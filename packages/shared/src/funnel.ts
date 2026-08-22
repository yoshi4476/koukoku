import type { ProjectGoal } from './api';
import { industryProfileFor } from './industry';

/**
 * 業種別 導線設計 (カスタマージャーニー) (F-28)。
 * 業種ごとに「認知→比較→獲得→リピート」の最適な導線(どの媒体で・どんな訴求で・
 * 何を計測するか)を提示し、素人でもプロの導線を組めるようにする。
 * 24業種を6アーキタイプに束ね、各業種のCV呼称を反映する。
 */

export type FunnelArchetype = 'ec' | 'local' | 'btob' | 'consideration' | 'recruit' | 'app' | 'lead';

export interface FunnelStage {
  key: string;
  /** 段階名 (認知 / 興味・比較 / 獲得 / リピート 等) */
  label: string;
  /** この段階の狙い */
  goal: string;
  /** おすすめ媒体 (日本語ラベル) */
  platforms: string[];
  /** 訴求・クリエイティブの方向性 */
  creative: string;
  /** 見るべきKPI */
  kpi: string;
  /** 計測ポイント (次段階への到達地点) */
  measure: string;
}

export interface IndustryFunnel {
  industryCode: string;
  industryLabel: string;
  archetype: FunnelArchetype;
  /** この業種の導線の特徴 */
  summary: string;
  stages: FunnelStage[];
}

/** 業種コード → 導線アーキタイプ */
const ARCHETYPE_OF: Record<string, FunnelArchetype> = {
  ec: 'ec', apparel: 'ec', food: 'ec', pet: 'ec',
  beauty: 'local', clinic_beauty: 'local', medical: 'local', clinic: 'local',
  fitness: 'local', repair: 'local', travel: 'local',
  btob: 'btob', saas: 'btob', legal: 'btob', finance: 'btob', education: 'btob',
  bridal: 'consideration', automotive: 'consideration', realestate: 'consideration',
  reform: 'consideration', moving: 'consideration', funeral: 'consideration',
  hr: 'recruit',
  app: 'app',
  other: 'lead',
};

const ARCHETYPE_SUMMARY: Record<FunnelArchetype, string> = {
  ec: '新規リーチ→再訪(リタゲ)→比較→購入→リピートの循環。LTVを伸ばすリピート導線が鍵。',
  local: 'エリア内での認知→口コミ・比較→予約/来店→再来店。MEOとLINEでリピートを取り切る。',
  btob: '課題顕在層に認知→資料DLで見込み育成→事例で比較検討→商談。検討期間が長く追客が重要。',
  consideration: '高額・高関与商材。認知→資料/カタログ→来場・相談→商談・成約。信頼と実績提示で不安を解消。',
  recruit: '認知→興味→応募の最短化が命。働く魅力の可視化と簡単応募で応募単価を下げる。',
  app: '認知→インストール→起動・登録→継続・課金。CPIだけでなく継続率(LTV)で判断する。',
  lead: '認知→興味・比較→獲得のシンプル導線。まず計測を整え、勝ち筋を見つけて拡大する。',
};

/** アーキタイプ別のステージ定義。{cv} は業種のCV呼称に置換 */
function stagesFor(a: FunnelArchetype, cv: string): FunnelStage[] {
  switch (a) {
    case 'ec':
      return [
        { key: 'awareness', label: '認知・新規リーチ', goal: '商品・ブランドを新しい人に知ってもらう', platforms: ['Meta(Instagram)', 'TikTok', 'ディスプレイ', 'Pinterest'], creative: '商品の魅力・世界観を短尺動画/ビジュアルで。ベネフィット訴求', kpi: 'CTR・フリークエンシー・サイト訪問単価', measure: 'サイト訪問・商品ページ閲覧' },
        { key: 'consider', label: '比較・再訪(リタゲ)', goal: '一度見た人を呼び戻し購入を後押し', platforms: ['リターゲティング(Meta/Google)', 'Criteo', 'Google検索'], creative: '価格・送料無料・レビュー・限定でひと押し', kpi: 'CVR・カート追加率', measure: 'カート追加・お気に入り登録' },
        { key: 'convert', label: `購入(${cv})`, goal: '刈り取り。購入完了まで導く', platforms: ['Google/Yahoo検索', 'ショッピング広告', 'リターゲティング'], creative: 'クーポン・数量/期間限定・あと少しの後押し', kpi: 'ROAS・CPA', measure: '購入完了' },
        { key: 'retention', label: 'リピート(LTV)', goal: '再購入で顧客生涯価値を伸ばす', platforms: ['LINE', 'メール/CRM', 'リターゲティング'], creative: '会員特典・再入荷・関連商品・レビュー依頼', kpi: 'リピート率・LTV', measure: '2回目以降の購入' },
      ];
    case 'local':
      return [
        { key: 'awareness', label: '認知(エリア内リーチ)', goal: '商圏の人に店・サービスを知らせる', platforms: ['Instagram', 'TikTok', 'Googleマップ(MEO)', 'LINE'], creative: 'ビフォーアフター・施術/店内の雰囲気・スタッフ', kpi: 'リーチ・保存・プロフィール到達', measure: 'プロフィール/LP訪問' },
        { key: 'consider', label: '興味・比較', goal: '口コミ・実績で「ここにしよう」を作る', platforms: ['Google検索(MEO)', '口コミ/LP', 'リターゲティング'], creative: '実績・口コミ・初回特典・料金の明朗さ', kpi: 'CTR・予約ページ到達率', measure: '予約ページ到達' },
        { key: 'convert', label: `予約・来店(${cv})`, goal: '予約・来店を確実に取る', platforms: ['Google検索', '予約導線(LP/予約システム)', 'リターゲティング'], creative: '初回割引・当日予約可・不安解消(痛くない等)', kpi: 'CPA・予約完了率', measure: '予約完了' },
        { key: 'retention', label: 'リピート・再来店', goal: '2回目以降の来店を作る', platforms: ['LINE公式', 'メール', 'リターゲティング'], creative: '次回クーポン・回数券・メンテ時期のお知らせ', kpi: '再来店率', measure: '2回目の予約' },
      ];
    case 'btob':
      return [
        { key: 'awareness', label: '認知(課題顕在層)', goal: '課題を持つ担当者に見つけてもらう', platforms: ['Google/Yahoo検索', '記事広告', 'ディスプレイ', 'Meta(BtoB)'], creative: '課題提起→解決の提示。専門性・分かりやすさ', kpi: 'CTR・サイト訪問単価', measure: 'サイト訪問' },
        { key: 'nurture', label: '情報収集(見込み育成)', goal: '資料DLでリードを獲得し育てる', platforms: ['リターゲティング', '検索', 'ホワイトペーパー配信'], creative: '事例集・ノウハウ資料・チェックリスト', kpi: '資料DLのCVR・リード単価', measure: '資料請求・ホワイトペーパーDL' },
        { key: 'consider', label: '比較検討', goal: '比較で優位に立ち商談に繋ぐ', platforms: ['指名/比較検索', '導入事例', 'リターゲティング'], creative: '導入事例・ROI・他社比較・無料トライアル', kpi: '商談化率', measure: '問い合わせ・デモ申込' },
        { key: 'convert', label: `商談・受注(${cv})`, goal: '商談化・受注まで追客する', platforms: ['指名検索', 'リマーケ', 'メール/CRM'], creative: '無料相談・デモ・導入支援の訴求', kpi: 'CPA(商談)・受注率', measure: '商談化・受注' },
      ];
    case 'consideration':
      return [
        { key: 'awareness', label: '認知', goal: '高関与商材の存在と魅力を知らせる', platforms: ['Meta', 'YouTube/動画', 'ディスプレイ', '検索'], creative: '憧れ・安心・実績。ビジュアルで世界観を伝える', kpi: 'リーチ・CTR', measure: 'サイト訪問' },
        { key: 'nurture', label: '情報収集', goal: '資料請求・カタログで検討層を掴む', platforms: ['検索', 'リターゲティング', '資料請求LP'], creative: '事例・実績・保証・費用の目安', kpi: '資料請求CVR', measure: '資料請求・カタログ請求' },
        { key: 'visit', label: '来場・問い合わせ', goal: '来場予約・相談に繋げる', platforms: ['指名/エリア検索', 'リターゲティング'], creative: '見学/相談予約・無料・特典・限定', kpi: 'CPA(来場)', measure: '来場予約・問い合わせ' },
        { key: 'convert', label: `商談・成約(${cv})`, goal: '追客して成約する', platforms: ['指名検索', 'リマーケ', 'メール/CRM'], creative: '限定特典・決め手の提示・不安解消', kpi: '成約率', measure: '成約' },
      ];
    case 'recruit':
      return [
        { key: 'awareness', label: '認知', goal: '求職者に会社・求人を知らせる', platforms: ['Instagram', 'TikTok', 'ディスプレイ', '求人検索'], creative: '働く魅力・社員の声・職場の雰囲気', kpi: 'リーチ・CTR・求人ページ訪問', measure: '求人ページ訪問' },
        { key: 'consider', label: '興味', goal: '待遇・環境で応募意欲を高める', platforms: ['リターゲティング', '検索'], creative: '待遇・福利厚生・キャリア・歓迎条件', kpi: '応募開始率', measure: '応募フォーム到達' },
        { key: 'convert', label: `応募(${cv})`, goal: '応募を最短で完了させる', platforms: ['検索', 'リターゲティング', '求人媒体'], creative: '簡単応募・未経験歓迎・スピード面接', kpi: 'CPA(応募)・応募完了率', measure: '応募完了' },
      ];
    case 'app':
      return [
        { key: 'awareness', label: '認知', goal: 'アプリの体験価値を知ってもらう', platforms: ['TikTok', 'Meta(Reels)', '動画/ディスプレイ'], creative: '使う楽しさ・課題解決を短尺動画で', kpi: 'CTR・CPI', measure: 'ストア遷移' },
        { key: 'install', label: `インストール(${cv})`, goal: 'インストールを獲得する', platforms: ['アプリキャンペーン(Google/Meta)', '検索'], creative: '無料・特典・レビュー評価', kpi: 'CPI・インストール率', measure: 'インストール' },
        { key: 'activate', label: '起動・登録', goal: '起動・会員登録まで進めてもらう', platforms: ['リエンゲージメント広告', 'プッシュ/CRM'], creative: '初回特典・オンボーディング', kpi: '起動率・登録率', measure: '会員登録・初回起動' },
        { key: 'retention', label: '継続・課金(LTV)', goal: '継続利用・課金でLTVを伸ばす', platforms: ['リターゲティング', 'CRM/プッシュ'], creative: '継続特典・限定コンテンツ', kpi: '継続率・ROAS', measure: '課金・定着' },
      ];
    case 'lead':
    default:
      return [
        { key: 'awareness', label: '認知', goal: 'ターゲットに存在を知らせる', platforms: ['Meta', '検索', 'ディスプレイ'], creative: 'ベネフィット・課題提起', kpi: 'CTR・訪問単価', measure: 'サイト訪問' },
        { key: 'consider', label: '興味・比較', goal: '比較検討層を引き戻す', platforms: ['リターゲティング', '検索'], creative: '実績・特典・信頼要素', kpi: 'CVR', measure: 'CVページ到達' },
        { key: 'convert', label: `獲得(${cv})`, goal: '刈り取り・CV獲得', platforms: ['検索', 'リターゲティング'], creative: '限定・無料・行動喚起', kpi: 'CPA', measure: 'コンバージョン完了' },
      ];
  }
}

export function buildFunnel(industryCode: string, goal: ProjectGoal): IndustryFunnel {
  const profile = industryProfileFor(industryCode);
  const archetype = ARCHETYPE_OF[profile.code] ?? 'lead';
  const cv = profile.cvLabel || 'CV';
  const stages = stagesFor(archetype, cv);
  // 目的が「認知」なら認知段階を強調する補足を先頭stageのgoalに付す
  if (goal === 'awareness' && stages[0]) {
    stages[0] = { ...stages[0], goal: stages[0].goal + '（今回の目的は認知。ここに予算を厚めに）' };
  }
  return { industryCode: profile.code, industryLabel: profile.label, archetype, summary: ARCHETYPE_SUMMARY[archetype], stages };
}
