/**
 * LP最適化(ポストクリック) (F-49)。
 * クリック後のLPは成約率(CVR)を直接左右する。CVRの主要レバーをチェックリスト化し、
 * 満たしているかで100点満点のスコアと、優先度の高い改善提案を出す。
 */

export interface LpCheckItem {
  key: string;
  label: string;
  weight: number; // 合計100
  hint: string; // 未達のときの改善提案
}

export const LP_CHECK_ITEMS: LpCheckItem[] = [
  { key: 'fv_value', label: 'ファーストビューで「誰の何を解決するか」が一目で伝わる', weight: 18, hint: '最初の画面に、ターゲットとベネフィットを一文で。読まなくても分かる大見出しに。' },
  { key: 'fv_cta', label: 'ファーストビューに申込/CTAボタンが見えている', weight: 14, hint: '最初の画面内に「申込む/資料請求」ボタンを配置。スクロールしないと押せない状態を避ける。' },
  { key: 'cta_multi', label: 'CTAボタンを上部・中段・最下部に複数配置', weight: 10, hint: '離脱直前でも押せるよう、ページの複数箇所に同じCTAを置く。' },
  { key: 'form_minimal', label: '入力フォームの項目を必要最小限に絞っている', weight: 14, hint: '項目を減らすほどCVは上がる。任意項目は削除、住所などは後工程へ。' },
  { key: 'speed', label: 'スマホで3秒以内に表示される（画像軽量化）', weight: 12, hint: '画像を圧縮し、初期表示を軽く。表示が遅いと直帰する。PageSpeedで確認を。' },
  { key: 'trust', label: '実績・口コミ・導入事例・保証などの信頼要素がある', weight: 12, hint: '実績数・お客様の声・第三者評価・返金保証などで不安を解消する。' },
  { key: 'offer_clear', label: 'オファー/特典が明確で目立っている', weight: 10, hint: '割引・特典・限定を一番目立つ位置に。行動する理由を明示する。' },
  { key: 'cv_tag', label: '申込完了ページにCV計測タグが設置されている', weight: 10, hint: 'サンクスページに計測タグを設置。計測欠落は最適化の致命傷（計測基盤も確認）。' },
];

export interface LpScoreItem extends LpCheckItem {
  done: boolean;
}

export interface LpScoreDto {
  score: number; // 0-100
  grade: 'good' | 'warn' | 'bad';
  items: LpScoreItem[];
  /** 未達のうち重みの大きい順の改善提案（最大3件） */
  topFixes: { label: string; hint: string }[];
  summary: string;
}

export function lpScore(checkedKeys: string[]): LpScoreDto {
  const checked = new Set(checkedKeys);
  const items: LpScoreItem[] = LP_CHECK_ITEMS.map((i) => ({ ...i, done: checked.has(i.key) }));
  const score = items.reduce((s, i) => s + (i.done ? i.weight : 0), 0);
  const grade: LpScoreDto['grade'] = score >= 80 ? 'good' : score >= 50 ? 'warn' : 'bad';
  const topFixes = items
    .filter((i) => !i.done)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3)
    .map((i) => ({ label: i.label, hint: i.hint }));
  const summary =
    grade === 'good'
      ? 'LPは成約しやすい状態です。細部のA/Bで更に伸ばせます。'
      : grade === 'warn'
        ? '成約率を上げる余地があります。重みの大きい項目から直しましょう。'
        : 'LPに改善余地が大きいです。ファーストビューと計測から着手を。CVR＝成約率に直結します。';
  return { score, grade, items, topFixes, summary };
}
