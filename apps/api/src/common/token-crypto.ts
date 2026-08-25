import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

/**
 * 媒体APIのリフレッシュトークンなど、DBに保存する秘密値の暗号化 (AES-256-GCM)。
 * 平文保存するとDB流出時にクライアントの広告アカウントを操作されるため必須。
 *
 * 鍵は TOKEN_ENCRYPTION_KEY (推奨) か、未設定なら AUTH_SECRET から導出する。
 * 鍵を変更すると既存トークンは復号できなくなり、媒体の再認証が必要になる。
 */

const SALT = 'adgrid-token-v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

function key(): Buffer {
  const secret = process.env.TOKEN_ENCRYPTION_KEY || process.env.AUTH_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('TOKEN_ENCRYPTION_KEY (または AUTH_SECRET) が未設定のため、媒体トークンを安全に保存できません');
    }
    // ローカル開発のみのデフォルト。本番では上で停止する
    return scryptSync('adgrid-local-dev-token-key', SALT, 32);
  }
  return scryptSync(secret, SALT, 32);
}

/** 平文を暗号化して単一のbase64文字列にする (iv + tag + 暗号文) */
export function encryptSecret(plain: string): string {
  if (!plain) return '';
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64');
}

/** encryptSecret の逆。復号できない場合は null (鍵変更・改ざん時) */
export function decryptSecret(payload: string): string | null {
  if (!payload) return null;
  try {
    const buf = Buffer.from(payload, 'base64');
    if (buf.length <= IV_BYTES + TAG_BYTES) return null;
    const iv = buf.subarray(0, IV_BYTES);
    const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const enc = buf.subarray(IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', key(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
