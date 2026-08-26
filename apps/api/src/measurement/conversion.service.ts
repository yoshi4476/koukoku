import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/errors';

/**
 * サーバーサイドCV送信 (F-55)。
 * クライアントのサイト(サンクスページ等)から受け取ったコンバージョンを保存し、
 * Meta Conversions API と GA4 Measurement Protocol へ転送する。
 *
 * 個人情報は SHA-256 でハッシュ化してから保存・送信する (平文は保持しない)。
 * eventId で重複排除し、ブラウザ側のピクセル計測との二重計上を防ぐ。
 */

const META_VERSION = process.env.META_GRAPH_VERSION || 'v21.0';
const GA4_ENDPOINT = 'https://www.google-analytics.com/mp/collect';
const SEND_TIMEOUT_MS = 8000;

export interface CollectInput {
  eventName?: string;
  eventId?: string;
  value?: number;
  currency?: string;
  occurredAt?: string;
  email?: string;
  phone?: string;
  gclid?: string;
  fbclid?: string;
  fbp?: string;
  clientIdGa4?: string; // GA4のクライアントID (_ga クッキー由来)
  sourceUrl?: string;
}

export interface CollectResult {
  accepted: boolean;
  eventId: string;
  duplicate: boolean;
  meta: 'sent' | 'failed' | 'skipped';
  ga4: 'sent' | 'failed' | 'skipped';
  message: string;
}

/** Metaの要求に従い、正規化(小文字・trim)してからSHA-256 */
function hashPii(v: string | undefined, kind: 'email' | 'phone'): string {
  if (!v) return '';
  let s = v.trim().toLowerCase();
  if (kind === 'phone') s = s.replace(/[^0-9]/g, ''); // 国番号を含む数字のみ
  if (!s) return '';
  return createHash('sha256').update(s).digest('hex');
}
function hashIp(ip: string | undefined): string {
  return ip ? createHash('sha256').update(ip).digest('hex').slice(0, 32) : '';
}
async function postJson(url: string, body: unknown): Promise<{ ok: boolean; status: number; text: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SEND_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    return { ok: res.ok, status: res.status, text: (await res.text().catch(() => '')).slice(0, 300) };
  } catch (e) {
    return { ok: false, status: 0, text: (e as Error).message };
  } finally {
    clearTimeout(timer);
  }
}

@Injectable()
export class ConversionService {
  private readonly logger = new Logger(ConversionService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** クライアントのCV受信トークンを発行(再発行)する */
  async issueToken(tenantId: string, clientId: string): Promise<string> {
    const token = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '').slice(0, 8);
    // クライアント実在をRLS下で確認してから、RLS対象外のトークン表に登録する
    const client = await this.prisma.withTenant(tenantId, (tx) => tx.client.findUnique({ where: { id: clientId } }));
    if (!client) {
      throw new AppError(HttpStatus.NOT_FOUND, 'クライアントが見つかりません。', 'クライアントを選び直してください。');
    }
    await this.prisma.ingestToken.upsert({
      where: { tenantId_clientId: { tenantId, clientId } },
      update: { token, enabled: true },
      create: { tenantId, clientId, token, enabled: true },
    });
    return token;
  }

  /**
   * 公開エンドポイントからのCV受信。token で tenant/client を解決する。
   * measurement_configs は RLS 対象のため、token 解決だけ管理者接続を使わず
   * findFirst をテナント跨ぎで行う必要がある → ingestToken は十分に長い秘密として扱う。
   */
  async collect(token: string, input: CollectInput, ctx: { ip?: string; userAgent?: string }): Promise<CollectResult> {
    const link = token ? await this.prisma.ingestToken.findUnique({ where: { token } }) : null;
    if (!link || !link.enabled) {
      throw new AppError(HttpStatus.NOT_FOUND, '計測トークンが無効です。', '計測設定画面でトークンを再発行してください。');
    }
    const cfg = await this.prisma.withTenant(link.tenantId, (tx) =>
      tx.measurementConfig.findUnique({ where: { tenantId_clientId: { tenantId: link.tenantId, clientId: link.clientId } } }),
    );
    if (!cfg) {
      throw new AppError(HttpStatus.FORBIDDEN, '計測設定が未登録です。', '計測設定を保存してからご利用ください。');
    }
    if (!cfg.serverSideEnabled) {
      throw new AppError(HttpStatus.FORBIDDEN, 'サーバーサイド計測が無効です。', '計測設定でサーバーサイド計測をONにしてください。');
    }

    const eventId = (input.eventId ?? '').trim() || randomUUID();
    const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
    const occurred = Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt;
    const emailHash = hashPii(input.email, 'email');
    const phoneHash = hashPii(input.phone, 'phone');

    const value = Number(input.value ?? 0) || 0;
    const currency = (input.currency ?? 'JPY').toUpperCase();
    const eventName = (input.eventName ?? 'Purchase').trim() || 'Purchase';

    // 重複排除は「先に枠を取る」方式にする。findUnique→送信→create の check-then-act だと、
    // サンクスページのダブルクリック等の並行リクエストが両方チェックを通過し、
    // 外部へ二重送信した上に後着の create が unique 制約違反で500になる。
    // 先に pending 行を作り、unique 制約で先勝ちさせてから送信する
    try {
      await this.prisma.withTenant(cfg.tenantId, (tx) =>
        tx.conversionEvent.create({
          data: {
            tenantId: cfg.tenantId, clientId: cfg.clientId, eventId, eventName, value, currency,
            occurredAt: occurred, emailHash, phoneHash,
            gclid: input.gclid ?? '', fbclid: input.fbclid ?? '', fbp: input.fbp ?? '',
            sourceUrl: (input.sourceUrl ?? '').slice(0, 500),
            userAgent: (ctx.userAgent ?? '').slice(0, 300),
            ipHash: hashIp(ctx.ip),
            metaStatus: 'pending', ga4Status: 'pending', errorMessage: '',
          },
        }),
      );
    } catch (e) {
      // 既に同一 eventId の行がある = 重複。送信せず既存の結果を返す
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const existing = await this.prisma.withTenant(cfg.tenantId, (tx) =>
          tx.conversionEvent.findUnique({
            where: { tenantId_clientId_eventId: { tenantId: cfg.tenantId, clientId: cfg.clientId, eventId } },
          }),
        );
        return {
          accepted: true, eventId, duplicate: true,
          meta: (existing?.metaStatus ?? 'skipped') as CollectResult['meta'],
          ga4: (existing?.ga4Status ?? 'skipped') as CollectResult['ga4'],
          message: '受信済みのイベントです（重複排除しました）。',
        };
      }
      throw e;
    }

    // 枠を確保できたのでここは1リクエストだけ。安心して外部送信する
    const errors: string[] = [];
    const meta = await this.sendMeta(cfg, {
      eventId, eventName, value, currency, occurred, emailHash, phoneHash,
      fbclid: input.fbclid ?? '', fbp: input.fbp ?? '',
      sourceUrl: input.sourceUrl ?? '', ip: ctx.ip ?? '', userAgent: ctx.userAgent ?? '',
    }, errors);
    const ga4 = await this.sendGa4(cfg, {
      eventName, value, currency, clientIdGa4: input.clientIdGa4 ?? '', eventId,
    }, errors);

    await this.prisma.withTenant(cfg.tenantId, (tx) =>
      tx.conversionEvent.update({
        where: { tenantId_clientId_eventId: { tenantId: cfg.tenantId, clientId: cfg.clientId, eventId } },
        data: { metaStatus: meta, ga4Status: ga4, errorMessage: errors.join(' / ').slice(0, 500) },
      }),
    );

    const sent = [meta === 'sent' ? 'Meta' : null, ga4 === 'sent' ? 'GA4' : null].filter(Boolean);
    return {
      accepted: true, eventId, duplicate: false, meta, ga4,
      message: sent.length ? `${sent.join(' / ')} へ送信しました。` : '送信先が設定されていないため記録のみ行いました。',
    };
  }

  private async sendMeta(
    cfg: { metaPixelId: string },
    e: { eventId: string; eventName: string; value: number; currency: string; occurred: Date;
         emailHash: string; phoneHash: string; fbclid: string; fbp: string; sourceUrl: string; ip: string; userAgent: string },
    errors: string[],
  ): Promise<'sent' | 'failed' | 'skipped'> {
    const tokenEnv = process.env.META_CAPI_ACCESS_TOKEN;
    if (!tokenEnv || !cfg.metaPixelId) return 'skipped';
    const userData: Record<string, unknown> = {};
    if (e.emailHash) userData.em = [e.emailHash];
    if (e.phoneHash) userData.ph = [e.phoneHash];
    if (e.fbp) userData.fbp = e.fbp;
    if (e.fbclid) userData.fbc = `fb.1.${Math.floor(e.occurred.getTime() / 1000)}.${e.fbclid}`;
    if (e.ip) userData.client_ip_address = e.ip;
    if (e.userAgent) userData.client_user_agent = e.userAgent;

    const body = {
      data: [{
        event_name: e.eventName,
        event_time: Math.floor(e.occurred.getTime() / 1000),
        event_id: e.eventId, // ブラウザ側ピクセルと同じIDを渡すと重複排除される
        action_source: 'website',
        event_source_url: e.sourceUrl || undefined,
        user_data: userData,
        custom_data: { value: e.value, currency: e.currency },
      }],
      ...(process.env.META_TEST_EVENT_CODE ? { test_event_code: process.env.META_TEST_EVENT_CODE } : {}),
    };
    // access_token はURLクエリではなくPOSTボディに入れる (プロキシ/アクセスログへの残留を防ぐ)
    const url = `https://graph.facebook.com/${META_VERSION}/${cfg.metaPixelId}/events`;
    const r = await postJson(url, { ...body, access_token: tokenEnv });
    if (!r.ok) {
      errors.push(`Meta:${r.status} ${r.text}`);
      this.logger.warn(`Meta CAPI failed (${r.status})`);
      return 'failed';
    }
    return 'sent';
  }

  private async sendGa4(
    cfg: { ga4MeasurementId: string },
    e: { eventName: string; value: number; currency: string; clientIdGa4: string; eventId: string },
    errors: string[],
  ): Promise<'sent' | 'failed' | 'skipped'> {
    const secret = process.env.GA4_API_SECRET;
    if (!secret || !cfg.ga4MeasurementId) return 'skipped';
    // GA4はclient_idが必須。取得できない場合はイベントIDから決定的に生成する
    const clientId = e.clientIdGa4 || `${Math.abs(hashNum(e.eventId))}.${Math.floor(Date.now() / 1000)}`;
    const name = e.eventName.toLowerCase() === 'purchase' ? 'purchase' : 'generate_lead';
    const body = {
      client_id: clientId,
      events: [{
        name,
        params: {
          value: e.value,
          currency: e.currency,
          transaction_id: e.eventId,
          engagement_time_msec: 1,
        },
      }],
    };
    const url = `${GA4_ENDPOINT}?measurement_id=${encodeURIComponent(cfg.ga4MeasurementId)}&api_secret=${encodeURIComponent(secret)}`;
    const r = await postJson(url, body);
    // GA4 MP は成功時 204。エラーでも200を返すことがあるためステータスのみで判定する
    if (!r.ok) {
      errors.push(`GA4:${r.status} ${r.text}`);
      this.logger.warn(`GA4 MP failed (${r.status})`);
      return 'failed';
    }
    return 'sent';
  }

  /** 直近の受信状況 (計測が本当に動いているかの確認用) */
  async recent(tenantId: string, clientId: string, limit = 20) {
    const rows = await this.prisma.withTenant(tenantId, (tx) =>
      tx.conversionEvent.findMany({
        where: { clientId },
        orderBy: { occurredAt: 'desc' },
        take: Math.min(limit, 100),
      }),
    );
    return rows.map((r) => ({
      id: r.id, eventId: r.eventId, eventName: r.eventName, value: r.value, currency: r.currency,
      occurredAt: r.occurredAt.toISOString(), metaStatus: r.metaStatus, ga4Status: r.ga4Status,
      errorMessage: r.errorMessage, hasEmail: !!r.emailHash, sourceUrl: r.sourceUrl,
    }));
  }
}

/** 文字列を数値化 (GA4のclient_idフォールバック用) */
function hashNum(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}
