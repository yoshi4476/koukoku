import { createHmac, timingSafeEqual } from 'crypto';

/**
 * OAuth の state 署名 (F-54 セキュリティ修正)。
 *
 * state に生の tenantId を入れると、攻撃者が自分の認可フローで
 * state=<被害者tenantId> に差し替えるだけで、被害者テナントの接続を
 * 攻撃者のトークンで上書きできてしまう (CSRF)。
 * tenantId + 発行時刻を HMAC 署名し、コールバックで検証・改竄と期限切れを弾く。
 */

const TTL_MS = 15 * 60 * 1000;

function secret(): string {
  // セッション署名鍵を流用 (本番では必ず実値が設定される)
  return process.env.AUTH_SECRET || 'adgrid-local-dev-secret-change-me';
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

/** tenantId から署名付き state を作る */
export function signOAuthState(tenantId: string): string {
  const payload = `${tenantId}.${Date.now()}`;
  return `${Buffer.from(payload).toString('base64url')}.${sign(payload)}`;
}

/** state を検証して tenantId を取り出す。改竄・期限切れ・不正形式は null */
export function verifyOAuthState(state: string): string | null {
  if (!state) return null;
  const parts = state.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  let payload: string;
  try {
    payload = Buffer.from(encoded, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const expected = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const sep = payload.lastIndexOf('.');
  if (sep < 0) return null;
  const tenantId = payload.slice(0, sep);
  const issuedAt = Number(payload.slice(sep + 1));
  if (!tenantId || !Number.isFinite(issuedAt)) return null;
  if (Date.now() - issuedAt > TTL_MS) return null;
  return tenantId;
}
