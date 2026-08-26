/**
 * システム管理者 (SaaS運営者) の判定 (F-61)。
 *
 * テナント内のロール(owner/admin)とは切り離し、環境変数だけで決める。
 * 理由: ロールで判定すると「テナントのオーナーを乗っ取れば運営者になれる」経路ができる。
 * 画面からは付与も剥奪もできないため、アプリ側の不具合では昇格し得ない。
 *
 * 依存を持たない単独モジュールにしてある (auth ⇄ guard の循環参照を避けるため)。
 */
export function platformAdminEmails(): string[] {
  return (process.env.PLATFORM_ADMIN_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isPlatformAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const list = platformAdminEmails();
  // 未設定なら誰も管理者にしない (fail-closed)。設定漏れで全開放されるより落ちるほうが安全
  if (list.length === 0) return false;
  return list.includes(email.trim().toLowerCase());
}
