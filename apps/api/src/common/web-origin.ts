/**
 * フロントの公開URL。WEB_ORIGIN はCORS用にカンマ区切りで複数指定できるため、
 * リンク生成には必ず先頭の1件だけを使う (split しないと
 * "https://a, https://b/share/..." のような壊れたURLを配ってしまう)。
 */
export function webOrigin(): string {
  return (process.env.WEB_ORIGIN ?? 'http://localhost:3000').split(',')[0].trim().replace(/\/$/, '');
}
