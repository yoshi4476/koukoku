/**
 * href に埋める前にURLを検証する (XSS対策)。
 * ユーザーが登録したLP/制作物のURLを <a href> にそのまま渡すと、
 * javascript: や data: スキームを仕込まれてクリック時にスクリプトが走る。
 * http/https のみ許可し、それ以外は null (リンクにしない)。
 */
export function safeHref(u: unknown): string | null {
  return typeof u === 'string' && /^https?:\/\//i.test(u.trim()) ? u.trim() : null;
}
