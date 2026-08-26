import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/errors';
import { MailService } from '../common/mail.service';
import { SessionGuard } from '../common/session.guard';
import { TrailService } from '../common/trail.service';

/** 有効期間。長すぎると盗まれたリンクの寿命が延びるため短くする */
const TTL_MS = 60 * 60 * 1000;

/** 申請の流量制限。メール単位は厳しく、IP単位は緩く (社内の共有IPで複数人が同時に忘れるため) */
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_MAX_EMAIL = 5;
const RATE_MAX_IP = 30;

/** 生の値は保存しない。DBが漏れてもリンクを再現できないようにする */
function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export function passwordResetUrl(token: string): string {
  const base = (process.env.WEB_ORIGIN ?? 'http://localhost:3000').split(',')[0].trim();
  return `${base.replace(/\/$/, '')}/reset?token=${token}`;
}

/**
 * パスワード再設定 (F-62)。
 *
 * 設計の要点:
 *  - トークンはSHA-256で保存し、生の値はメール/リンクにしか存在しない
 *  - 「本人申請」はメール未設定でも成功を返す (アカウントの有無を推測させない)
 *  - 管理者はリンクを直接発行できる。メール基盤が無くても運用が回るようにするため
 *  - 再設定するとそれ以前のセッションは全て無効になる
 */
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly trail: TrailService,
  ) {}

  /** 申請の流量制限 (メール爆撃・トークン乱発を防ぐ)。キーは IP とメールの両方 */
  private hits = new Map<string, number[]>();

  private rateLimited(key: string, max: number): boolean {
    const now = Date.now();
    const arr = (this.hits.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
    if (arr.length >= max) {
      this.hits.set(key, arr);
      return true;
    }
    arr.push(now);
    this.hits.set(key, arr);
    // 溜まりすぎたら古いキーを掃除する
    if (this.hits.size > 10_000) {
      for (const [k, v] of this.hits) {
        if (v.every((t) => now - t >= RATE_WINDOW_MS)) this.hits.delete(k);
      }
    }
    return false;
  }

  /** トークンを発行して生の値を返す。呼び出し元が渡し方 (メール/画面) を決める */
  private async issue(userId: string, issuedBy: string): Promise<string> {
    const raw = randomBytes(32).toString('base64url');
    // 未使用の古いトークンは無効化する (同時に複数生きている状態を作らない)
    await this.prisma.passwordReset.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: new Date() },
    });
    await this.prisma.passwordReset.create({
      data: {
        userId,
        tokenHash: hashToken(raw),
        expiresAt: new Date(Date.now() + TTL_MS),
        issuedBy,
      },
    });
    return raw;
  }

  /**
   * 本人からの再設定申請。
   * アカウントの有無に関わらず常に成功を返す (存在するメールを探る手口を防ぐ)。
   */
  async requestReset(email: string, ip?: string): Promise<{ ok: true }> {
    const normalized = (email ?? '').trim().toLowerCase();
    // 流量制限に達しても成功を返す (429を返すと「そのメールは登録済み」を推測する材料になる)。
    // 内部的に発行を止めるだけで、外から見える挙動は変えない
    if (this.rateLimited(`e:${normalized}`, RATE_MAX_EMAIL) || (ip && this.rateLimited(`ip:${ip}`, RATE_MAX_IP))) {
      this.logger.warn(`パスワード再設定の申請が流量制限に達しました (email=${normalized} ip=${ip ?? '-'})`);
      return { ok: true };
    }
    const user = normalized ? await this.prisma.user.findUnique({ where: { email: normalized } }) : null;
    if (!user) return { ok: true };

    const raw = await this.issue(user.id, 'self');
    const url = passwordResetUrl(raw);
    const sent = await this.mail.send({
      to: user.email,
      subject: '【ADGRID】パスワード再設定のご案内',
      text: [
        `${user.name} 様`,
        '',
        'パスワード再設定のリクエストを受け付けました。',
        '下記のリンクから1時間以内に新しいパスワードを設定してください。',
        '',
        url,
        '',
        'このリクエストに心当たりが無い場合は、このメールを破棄してください。',
        'リンクを開かない限り、パスワードは変更されません。',
      ].join('\n'),
    });
    if (!sent) {
      // メール基盤が無い環境では、運営がログから拾って手渡しできるようにする
      this.logger.warn(`パスワード再設定リンクを発行しました (メール未送信): user=${user.email}`);
    }
    return { ok: true };
  }

  /** 管理者による発行。メールに頼らず、その場でリンクを渡せるようにする */
  async issueLinkFor(email: string, issuedBy: 'platform' | 'owner'): Promise<{ url: string; email: string }> {
    const normalized = (email ?? '').trim().toLowerCase();
    const user = normalized ? await this.prisma.user.findUnique({ where: { email: normalized } }) : null;
    if (!user) {
      throw new AppError(
        HttpStatus.NOT_FOUND,
        'そのメールアドレスのユーザーが見つかりません。',
        '一覧に表示されているメールアドレスを確認してください。',
      );
    }
    const raw = await this.issue(user.id, issuedBy);
    // 発行自体も監査に残す (リンクの乱発が調査で追えるように)
    const memberships = await this.prisma.tenantMember.findMany({ where: { userId: user.id } });
    for (const m of memberships) {
      await this.trail.record({
        tenantId: m.tenantId,
        userId: user.id,
        action: 'password_reset_link_issued',
        resource: `issued_by:${issuedBy}`,
      });
    }
    return { url: passwordResetUrl(raw), email: user.email };
  }

  /** トークンが今使えるかだけを確認する (画面を開いた時点での判定用) */
  async verify(token: string): Promise<{ valid: boolean }> {
    const row = await this.find(token);
    return { valid: row != null };
  }

  private async find(token: string) {
    const raw = (token ?? '').trim();
    if (!raw) return null;
    const row = await this.prisma.passwordReset.findUnique({ where: { tokenHash: hashToken(raw) } });
    if (!row || row.usedAt || row.expiresAt.getTime() < Date.now()) return null;
    // ハッシュ一致は findUnique で保証されるが、比較を定数時間にして念のため揃える
    const a = Buffer.from(row.tokenHash);
    const b = Buffer.from(hashToken(raw));
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    return row;
  }

  async reset(token: string, password: string): Promise<{ ok: true }> {
    if ((password ?? '').length < 8) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'パスワードが短すぎます。',
        '8文字以上のパスワードを設定してください。',
      );
    }
    const row = await this.find(token);
    if (!row) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'このリンクは使用できません。',
        '有効期限が切れているか、既に使用済みです。もう一度パスワード再設定をやり直してください。',
      );
    }

    const now = new Date();
    const passwordHash = await bcrypt.hash(password, 10);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: row.userId },
        // 世代を進めて発行済みセッションを全て無効化する。乗っ取られた状態で
        // 再設定しても攻撃者のセッションが残っては意味がないため
        data: { passwordHash, passwordChangedAt: now, tokenVersion: { increment: 1 } },
      }),
      this.prisma.passwordReset.update({ where: { id: row.id }, data: { usedAt: now } }),
    ]);
    SessionGuard.invalidateUser(row.userId);
    // 監査ログに残す (アカウント乗っ取りの調査で最初に見る事象のため)。
    // 所属する全テナントに記録する。どのテナントの管理者からも見えるようにする
    const memberships = await this.prisma.tenantMember.findMany({ where: { userId: row.userId } });
    for (const m of memberships) {
      await this.trail.record({
        tenantId: m.tenantId,
        userId: row.userId,
        action: 'password_reset',
        resource: `issued_by:${row.issuedBy}`,
      });
    }
    return { ok: true };
  }
}
