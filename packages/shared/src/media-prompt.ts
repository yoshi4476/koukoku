import { industryProfileFor } from './industry';
import type { ProjectBrief, ProjectGoal } from './api';

/**
 * 画像・動画 生成プロンプトの自動作成 (F-32)。
 * 業種・ヒアリング・訴求から、外部の画像/動画生成AIに貼るだけの高品質プロンプトを組み立てる。
 * 画像モデルは英語プロンプトで品質が出やすいため英語を主とし、日本語併記する。
 */

/** 画像生成(Imagen)の結果 */
export interface ImageGenResultDto {
  url: string;
  model: string;
  count: number;
  costJpy: number;
}

export interface MediaPromptSet {
  /** 画像生成AI用 (英語・推奨) */
  imagePrompt: string;
  /** 画像生成AI用 (日本語) */
  imagePromptJa: string;
  /** 除外したい要素 (negative prompt) */
  negativePrompt: string;
  /** 動画生成AI用 (英語) */
  videoPrompt: string;
  /** 推奨アスペクト比 (媒体別) */
  aspectRatios: { label: string; ratio: string }[];
  /** スタイルの補足 */
  styleNote: string;
  /** おすすめ画像API */
  imageApis: { name: string; note: string }[];
  /** おすすめ動画API */
  videoApis: { name: string; note: string }[];
}

/** 業種ごとの被写体・シーン・雰囲気(英語)。画像の質を業種に合わせるための核 */
const VISUAL: Record<string, { subject: string; scene: string; mood: string }> = {
  ec: { subject: 'the product as a clean hero shot', scene: 'minimal studio backdrop with soft gradient', mood: 'crisp, premium, desirable' },
  apparel: { subject: 'a stylish model wearing the apparel', scene: 'editorial fashion set with natural light', mood: 'trendy, confident, aspirational' },
  food: { subject: 'an appetizing dish or product close-up', scene: 'rustic wooden table with fresh ingredients', mood: 'warm, mouth-watering, fresh' },
  app: { subject: 'a person happily using a smartphone app', scene: 'bright modern lifestyle setting', mood: 'energetic, effortless, modern' },
  btob: { subject: 'confident business professionals collaborating', scene: 'clean modern office with soft daylight', mood: 'trustworthy, professional, forward-looking' },
  bridal: { subject: 'an elegant bride and groom', scene: 'luxurious wedding venue with soft bokeh', mood: 'romantic, elegant, joyful' },
  automotive: { subject: 'a sleek car in a dramatic setting', scene: 'clean showroom or scenic road at golden hour', mood: 'powerful, refined, premium' },
  medical: { subject: 'a caring doctor with a reassured patient', scene: 'clean bright clinic interior', mood: 'safe, gentle, trustworthy' },
  travel: { subject: 'a breathtaking travel destination with a happy traveler', scene: 'scenic landscape at golden hour', mood: 'inviting, adventurous, relaxing' },
  beauty: { subject: 'a close-up of glowing healthy skin / relaxed client', scene: 'clean bright beauty studio, soft natural light', mood: 'clean, radiant, calming' },
  saas: { subject: 'a professional using a laptop with a clean UI', scene: 'minimal bright workspace', mood: 'smart, efficient, modern' },
  finance: { subject: 'a reassured client and advisor shaking hands', scene: 'refined office with warm light', mood: 'secure, trustworthy, calm' },
  hr: { subject: 'a diverse, smiling team at work', scene: 'bright inviting office', mood: 'welcoming, positive, dynamic' },
  realestate: { subject: 'a bright, beautiful modern home interior', scene: 'sunlit living room, tidy staging', mood: 'warm, spacious, aspirational' },
  education: { subject: 'a focused learner achieving a goal', scene: 'clean study space or bright classroom', mood: 'motivating, bright, hopeful' },
  clinic_beauty: { subject: 'a confident client with radiant skin', scene: 'premium clinic interior, soft light', mood: 'clean, premium, reassuring' },
  fitness: { subject: 'a fit person mid-workout', scene: 'modern gym with dramatic light', mood: 'energetic, motivating, strong' },
  legal: { subject: 'a trustworthy professional in consultation', scene: 'refined office with bookshelves, warm light', mood: 'authoritative, calm, reliable' },
  repair: { subject: 'a friendly technician solving a problem', scene: 'clean on-site setting', mood: 'reliable, prompt, reassuring' },
  reform: { subject: 'a stunning before/after home renovation', scene: 'bright renovated interior', mood: 'fresh, quality, satisfying' },
  pet: { subject: 'an adorable happy pet with owner', scene: 'cozy warm home setting', mood: 'heartwarming, cute, joyful' },
  moving: { subject: 'a cheerful moving crew handling boxes carefully', scene: 'bright home entrance', mood: 'reliable, friendly, smooth' },
  funeral: { subject: 'a serene, respectful memorial setting with flowers', scene: 'calm dignified interior, soft light', mood: 'gentle, respectful, sincere' },
  other: { subject: 'the product or service in use', scene: 'clean modern setting with soft light', mood: 'clear, appealing, professional' },
};

function briefTokens(brief: ProjectBrief) {
  const t = (v: string) => (v ?? '').trim();
  return {
    product: t(brief.product) || t(brief.business),
    usp: t(brief.usp),
    offer: t(brief.offer),
    persona: t(brief.targetPersona),
  };
}

export function buildMediaPrompts(industryCode: string, brief: ProjectBrief, headline: string, goal: ProjectGoal): MediaPromptSet {
  const profile = industryProfileFor(industryCode);
  const v = VISUAL[profile.code] ?? VISUAL.other;
  const { product, usp, persona } = briefTokens(brief);
  const productClause = product ? ` featuring ${product}` : '';
  const personaClause = persona ? `, target audience: ${persona}` : '';

  const imagePrompt =
    `Professional advertising photograph for a ${profile.label} brand${productClause}: ${v.subject}, ${v.scene}. ` +
    `Mood: ${v.mood}. High-end commercial photography, sharp focus, realistic lighting, shallow depth of field, ` +
    `clean composition with empty space for a headline, vibrant but natural colors, 8k, highly detailed${personaClause}. ` +
    `No text, no logos, no watermarks.`;

  const imagePromptJa =
    `${profile.label}の広告用プロ写真${product ? `（${product}）` : ''}。${v.subject}を主役に、清潔感のある背景。` +
    `雰囲気は「${v.mood}」。ハイエンドな商用写真、シャープなピント、自然な光、被写界深度で背景をぼかし、` +
    `見出しを載せる余白を残した構図、鮮やかで自然な色。文字・ロゴ・透かしは入れない。` +
    (usp ? `強み: ${usp} が伝わる雰囲気。` : '');

  const negativePrompt =
    'text, letters, words, captions, watermark, logo, extra fingers, deformed hands, distorted face, ' +
    'lowres, blurry, jpeg artifacts, oversaturated, ugly, duplicate, bad anatomy, cluttered background';

  const videoPrompt =
    `A 6-8 second vertical advertising video for a ${profile.label} brand${productClause}. ` +
    `Opening: an eye-catching hook in the first 2 seconds showing ${v.subject}. ` +
    `Setting: ${v.scene}, mood ${v.mood}. Smooth cinematic camera movement (slow push-in / gentle pan), ` +
    `soft natural lighting, shallow depth of field, upbeat pacing. Leave space at the bottom for captions and a CTA. ` +
    `No on-screen text baked in.`;

  return {
    imagePrompt,
    imagePromptJa,
    negativePrompt,
    videoPrompt,
    aspectRatios: [
      { label: 'フィード(正方形)', ratio: '1:1' },
      { label: 'ストーリー/リール(縦)', ratio: '9:16' },
      { label: 'ディスプレイ(横)', ratio: '1.91:1' },
    ],
    styleNote: headline
      ? `見出し「${headline}」に合う雰囲気に。生成後、当システムの「自動バナー」で文字を載せると崩れません。`
      : '生成後、当システムの「自動バナー」で文字を載せると崩れません。',
    imageApis: [
      { name: 'Google Imagen 4 (Vertex/Gemini API)', note: '写真品質・日本語プロンプト対応。広告用の人物/商品に強い。まずここが無難' },
      { name: 'OpenAI GPT-Image / DALL·E 3 (Images API)', note: '指示追従が高く文字入り構図も比較的得意。手軽なREST' },
      { name: 'Adobe Firefly (API)', note: '商用利用の権利がクリアで企業案件向き。ブランド安全' },
      { name: 'Midjourney', note: '画質は最高峰だが公式APIが弱く自動化しにくい(手動運用向け)' },
    ],
    videoApis: [
      { name: 'Google Veo 3 (Vertex/Gemini API)', note: '実写級の短尺動画。音声も。広告動画の第一候補' },
      { name: 'Runway Gen-4 (API)', note: '画像→動画・モーション制御が柔軟。制作寄り' },
      { name: 'Luma Dream Machine (API)', note: '低コストで短尺量産に向く' },
      { name: 'OpenAI Sora', note: '高品質だがAPI提供状況を要確認' },
    ],
  };
}
