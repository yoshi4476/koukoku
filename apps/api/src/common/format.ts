/** 円の整形 (レポート・提案シミュレーション共通) */
export function fmtYen(n: number): string {
  return '¥' + Math.round(n).toLocaleString('ja-JP');
}
