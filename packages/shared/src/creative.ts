import { z } from 'zod';
import type { AppealAxis } from './ai';
import type { IndustryProfile } from './industry';
import type { ProjectBrief, ProjectGoal } from './api';

/** LLMが返すクリエイティブ生成の出力スキーマ (実AI接続時に検証) */
export const CreativeGenResultSchema = z.object({
  variants: z
    .array(
      z.object({
        appeal_axis: z.string(),
        headline: z.string().min(1),
        description: z.string(),
        primary_text: z.string(),
        cta: z.string(),
        banner_concept: z.string(),
        rationale: z.string(),
      }),
    )
    .min(1),
});
export type CreativeGenResult = z.infer<typeof CreativeGenResultSchema>;

/** LLM出力(snake_case)を CreativeVariant に写像する */
export function creativeVariantFromLlm(v: CreativeGenResult['variants'][number]): CreativeVariant {
  return {
    appealAxis: v.appeal_axis as AppealAxis,
    headline: v.headline,
    description: v.description,
    primaryText: v.primary_text,
    cta: v.cta,
    bannerConcept: v.banner_concept,
    rationale: v.rationale,
  };
}

/** 業種+ヒアリングから生成した1案のクリエイティブ (1案=1訴求軸を厳守) */
export interface CreativeVariant {
  appealAxis: AppealAxis;
  /** 見出し (検索広告/フィード見出し) */
  headline: string;
  /** 説明文 (検索広告の説明) */
  description: string;
  /** 本文 (SNS/フィードのプライマリテキスト) */
  primaryText: string;
  /** CTAボタン文言 */
  cta: string;
  /** 画像バナーの構成案 (ビジュアルの方向性) */
  bannerConcept: string;
  /** なぜこの業種・訴求で効くか */
  rationale: string;
}

/** 生成APIの応答 */
export interface CreativeGenDto {
  /** ANTHROPIC_API_KEY 未設定でテンプレ生成した場合 true */
  mocked: boolean;
  industryLabel: string;
  variants: CreativeVariant[];
}

/** 採用API: 選んだ案を制作物(広告文)として登録する */
export interface AdoptCreativeInput {
  variants: CreativeVariant[];
}

/** 最初の非空・トリム済み文字列。全て空なら fallback */
function pick(fallback: string, ...vals: (string | undefined)[]): string {
  for (const v of vals) {
    const t = (v ?? '').trim();
    if (t) return t;
  }
  return fallback;
}

/** 目標とCV呼称からCTA文言を決める */
function ctaFor(goal: ProjectGoal, cvLabel: string): string {
  if (goal === 'store') return 'ご予約はこちら';
  if (goal === 'awareness') return '詳しく見る';
  if (goal === 'traffic') return '公式サイトへ';
  // conversion
  const map: Record<string, string> = {
    購入: '今すぐ購入', 応募: '応募する', 予約: '今すぐ予約', 来店予約: '来店を予約',
    問い合わせ: '無料で相談', 資料請求: '資料を請求', 見積: '無料見積もり', 申込: '今すぐ申込む',
    登録: '無料で登録', 査定: '無料査定', 入会: '入会する', 相談: '無料相談',
  };
  return map[cvLabel] ?? `今すぐ${cvLabel}`;
}

/** 訴求軸ごとの生成ロジック。ヒアリング(brief)の具体情報を差し込み、業種に沿った1案を作る */
function buildOne(axis: AppealAxis, t: Tokens): Omit<CreativeVariant, 'appealAxis'> {
  const { product, offer, usp, pain, persona, area, proof, cv, industry, cta } = t;
  const areaTag = area ? `${area}で` : '';
  switch (axis) {
    case '価格・オファー':
      return {
        headline: offer ? truncate(`${offer}｜${product}`, 24) : `まずはお得に${product}`,
        description: `${pick(`${product}をはじめるなら今。`, offer && `${offer}を実施中。`)}詳しい料金はこちらでご確認いただけます。`,
        primaryText: `${areaTag}${product}をお探しの方へ。${pick('今ならお得にはじめられます。', offer && `${offer}。`)}${proof ? `${proof}。` : ''}まずは気軽にご確認ください。`,
        cta,
        bannerConcept: `オファー(${pick('特典', offer)})を最も大きく中央に。価格・割引率を数字で強調し、締切や条件を小さく添える。背景は清潔感のある${industry}らしい配色。`,
        rationale: `${industry}は価格・特典への反応が大きい。オファーを主役にすると初回CVを取りやすい。`,
      };
    case '社会的証明':
      return {
        headline: proof ? truncate(`${proof}｜${product}`, 24) : `多くの方に選ばれる${product}`,
        description: `${pick('多くの方にご利用いただいています。', proof && `${proof}。`)}利用者の声・事例を公開中です。`,
        primaryText: `${persona ? `${persona}に支持される` : '選ばれ続ける'}${product}。${pick('たくさんの実績があります。', proof && `${proof}。`)}実際の口コミ・事例をご覧ください。`,
        cta,
        bannerConcept: `利用者の声・★評価・導入数/実績の数字を大きく。実際の利用シーン写真や「顔の見える」ビジュアルで信頼感を演出。`,
        rationale: `${industry}は失敗したくない心理が強く、実績・口コミの提示が意思決定を後押しする。`,
      };
    case '緊急性・限定':
      return {
        headline: truncate(`${pick('今だけ', offer)}｜${product}`, 24),
        description: `${pick('期間・数量に限りがあります。', offer && `${offer}は期間限定。`)}お早めにご確認ください。`,
        primaryText: `${areaTag}${product}を検討中の方へ。${pick('今の時期がおすすめです。', offer && `${offer}は今だけ。`)}枠・在庫には限りがあります。気になる方はお早めに。`,
        cta,
        bannerConcept: `「期間限定」「残りわずか」を目立つ色(赤/オレンジ)で。締切日やカウントダウン要素を添え、行動を急がせる。`,
        rationale: `限定・締切は先延ばしを防ぎ、${industry}の比較検討層を今の行動へ動かす。`,
      };
    case '便益':
      return {
        headline: usp ? truncate(usp, 24) : `${product}で${pick('成果を実感', proof)}`,
        description: `${pick(`${product}の特長をわかりやすくご紹介。`, usp && `${usp}。`)}詳しくはこちらから。`,
        primaryText: `${pain ? `${pain}とお悩みではありませんか。` : `${product}をお探しですか。`}${pick(`${product}なら解決できます。`, usp && `${usp}。`)}まずは詳細をご確認ください。`,
        cta,
        bannerConcept: `商材の一番の強み(${pick('ベネフィット', usp)})をキャッチコピー化。ビフォーアフターや使用イメージで「得られる結果」を可視化。`,
        rationale: `${industry}では「自分にどう役立つか」を具体的に示すとクリック率が上がる。`,
      };
    case '損失回避':
      return {
        headline: pain ? truncate(`その${pain}、大丈夫ですか`, 24) : `${product}、後回しにしていませんか`,
        description: `${pick('放置するほど負担は大きくなります。', pain && `${pain}は早めの対策が肝心。`)}今できることをご案内します。`,
        primaryText: `${pick('気づかないうちに損をしているかもしれません。', pain && `${pain}を放置すると損失が広がります。`)}${product}で早めに見直しませんか。${proof ? `${proof}。` : ''}`,
        cta,
        bannerConcept: `「放置するとこうなる」というリスクを可視化(グラフ/対比)。不安を喚起しつつ、解決策として商材を提示。`,
        rationale: `人は得より損失を強く避ける。${industry}の課題を明確化すると相談・問い合わせに繋がりやすい。`,
      };
    case '権威':
      return {
        headline: truncate(`${pick('専門家監修', proof)}の${product}`, 24),
        description: `${pick('専門的な知見をもとに提供しています。', proof && `${proof}。`)}安心してご利用いただけます。`,
        primaryText: `${product}は${pick('専門家の知見をもとに設計されています。', proof && `${proof}。`)}${persona ? `${persona}にも安心してお使いいただけます。` : ''}詳しい情報をご覧ください。`,
        cta,
        bannerConcept: `監修者・資格・受賞・メディア掲載などの権威バッジを配置。落ち着いた配色で専門性・信頼を訴求。`,
        rationale: `${industry}は専門性・安全性が重視されるため、権威付けが不安を解消する。`,
      };
    case '新規性':
      return {
        headline: truncate(`新しい${product}${offer ? `｜${offer}` : ''}`, 24),
        description: `${pick(`${product}が新しくなりました。`, usp && `${usp}。`)}変更点をチェック。`,
        primaryText: `${pick(`これまでにない${product}が登場。`, usp && `${usp}。`)}${persona ? `${persona}におすすめです。` : ''}新しい体験をぜひご確認ください。`,
        cta,
        bannerConcept: `「NEW」「新登場」を強調。従来との違いを対比で示し、目新しさ・話題性を前面に。`,
        rationale: `新規性は関心を引きやすく、${industry}の潜在層の認知獲得に有効。`,
      };
    case '簡便性':
    default:
      return {
        headline: `かんたん${cv}｜${truncate(product, 16)}`,
        description: `${pick('専門知識は不要。', usp && `${usp}。`)}はじめての方でもすぐにご利用いただけます。`,
        primaryText: `${pain ? `${pain}でお困りでも大丈夫。` : ''}${product}なら${pick('手間なくかんたんに始められます。', usp && `${usp}。`)}まずはお気軽にどうぞ。`,
        cta,
        bannerConcept: `「3ステップで完了」など手順を図解。ハードルの低さ・手軽さをシンプルなUI風ビジュアルで表現。`,
        rationale: `手間・不安が障壁になりやすい${industry}では、簡単さの提示が申込の後押しになる。`,
      };
  }
}

interface Tokens {
  product: string; offer: string; usp: string; pain: string; persona: string;
  area: string; proof: string; cv: string; industry: string; cta: string;
}

function truncate(s: string, max: number): string {
  // コードポイント単位で扱う。s.slice はサロゲートペア(絵文字)を分断して
  // 壊れた文字(U+FFFD)を残すため、[...s] で1文字ずつに分けてから切る
  const chars = [...s];
  return chars.length <= max ? s : chars.slice(0, max - 1).join('') + '…';
}

/**
 * 業種プロファイルとヒアリングシートから、業種に適したクリエイティブ案を複数生成する (F-26)。
 * ANTHROPIC_API_KEY 無しでも動くよう決定的に構成。訴求軸は業種の推奨順を使う。
 */
export function buildCreativeVariants(
  profile: IndustryProfile,
  brief: ProjectBrief,
  goal: ProjectGoal,
  count: number,
): CreativeVariant[] {
  const cv = profile.cvLabel || 'お申込み';
  const t: Tokens = {
    product: pick(`${profile.label}サービス`, brief.product, brief.business),
    offer: (brief.offer ?? '').trim(),
    usp: (brief.usp ?? '').trim(),
    pain: (brief.painPoint ?? '').trim(),
    persona: (brief.targetPersona ?? '').trim(),
    area: (brief.area ?? '').trim(),
    proof: (brief.reasonToChoose ?? '').trim(),
    cv,
    industry: profile.label,
    cta: ctaFor(goal, cv),
  };
  const axes = profile.appealAxes.length ? profile.appealAxes : (['便益', '社会的証明', '価格・オファー'] as AppealAxis[]);
  const n = Math.min(Math.max(count, 1), 8);
  const out: CreativeVariant[] = [];
  for (let i = 0; i < n; i++) {
    const axis = axes[i % axes.length];
    out.push({ appealAxis: axis, ...buildOne(axis, t) });
  }
  return out;
}
