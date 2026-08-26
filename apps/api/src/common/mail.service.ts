import { Injectable, Logger } from '@nestjs/common';

export interface MailInput {
  to: string;
  subject: string;
  /** プレーンテキスト本文。HTMLメールは使わない (到達率と可読性を優先) */
  text: string;
}

/**
 * メール送信 (F-62)。
 *
 * 送信基盤が未契約でもシステムを止めないため、鍵が無ければ「送らない」だけで
 * 例外にはしない。パスワード再設定は管理者がリンクを直接渡す運用でも成立するため、
 * メールはあくまで自動化の手段という位置づけ。
 *
 * RESEND_API_KEY と MAIL_FROM を設定すると自動的に実送信に切り替わる。
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  get available(): boolean {
    return !!(process.env.RESEND_API_KEY && process.env.MAIL_FROM);
  }

  /** 送信できたかを返す。失敗しても例外は投げない (呼び出し元の処理を止めないため) */
  async send(input: MailInput): Promise<boolean> {
    if (!this.available) {
      this.logger.warn(`メール未設定のため送信をスキップしました (to=${input.to})`);
      return false;
    }
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: process.env.MAIL_FROM,
          to: [input.to],
          subject: input.subject,
          text: input.text,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        this.logger.error(`メール送信に失敗しました (status=${res.status})`);
        return false;
      }
      return true;
    } catch (e) {
      this.logger.error(`メール送信に失敗しました: ${(e as Error).message}`);
      return false;
    }
  }
}
