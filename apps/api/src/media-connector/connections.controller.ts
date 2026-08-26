import { Body, Controller, Delete, Get, HttpStatus, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { AuthorizeResultDto, ConnectionDto, ConnectionStatus, Platform, SyncResultDto } from '@adgrid/shared';
import { ALL_PLATFORMS } from '@adgrid/shared';
import { PrismaService } from '../prisma/prisma.service';
import { TenantId } from '../common/tenant';
import { AppError } from '../common/errors';
import { BillingService } from '../billing/billing.service';
import { MediaSyncService } from './sync.service';
import { GoogleAdsConnector } from './google-ads.connector';
import { encryptSecret } from '../common/token-crypto';
import { webOrigin } from '../common/web-origin';
import { verifyOAuthState } from '../common/oauth-state';

@Controller('connections')
export class ConnectionsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: MediaSyncService,
    private readonly billing: BillingService,
  ) {}

  @Get()
  async list(@TenantId() tenantId: string): Promise<ConnectionDto[]> {
    return this.prisma.withTenant(tenantId, async (tx) => {
      const [conns, counts] = await Promise.all([
        tx.mediaConnection.findMany({ orderBy: { platform: 'asc' } }),
        tx.adAccount.groupBy({ by: ['platform'], _count: { _all: true } }),
      ]);
      const countMap = new Map(counts.map((c) => [c.platform, c._count._all]));
      return conns.map((c) => ({
        id: c.id,
        platform: c.platform as Platform,
        status: c.status as ConnectionStatus,
        mode: c.mode as 'mock' | 'oauth',
        lastSyncedAt: c.lastSyncedAt?.toISOString() ?? null,
        lastSyncRows: c.lastSyncRows,
        errorMessage: c.errorMessage,
        accountCount: countMap.get(c.platform) ?? 0,
      }));
    });
  }

  /** ウィザードStep2: 認可 (実API未設定時はデモ接続候補を返す) */
  @Post(':platform/authorize')
  authorize(@TenantId() tenantId: string, @Param('platform') platform: string): Promise<AuthorizeResultDto> {
    if (!ALL_PLATFORMS.includes(platform as Platform)) {
      throw new AppError(HttpStatus.BAD_REQUEST, '不明な媒体です。', '媒体を選び直してください。');
    }
    return this.sync.authorize(tenantId, platform as Platform);
  }

  /**
   * Google OAuth コールバック (F-54)。認可コードをリフレッシュトークンに交換し暗号化保存する。
   * ブラウザからの遷移先のため認証クッキーが無い場合があり、テナントは state で受け取る。
   */
  @Get('google_ads/callback')
  async googleCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string,
    @Res() res: Response,
  ): Promise<void> {
    const back = (q: string) => res.redirect(`${webOrigin()}/connections?${q}`);
    if (error) return back(`google=denied`);
    if (!code || !state) return back(`google=invalid`);
    // state を検証して tenantId を取り出す。生tenantId受け取りだと、攻撃者が
    // state=<被害者tenantId> に差し替えて被害者の接続を自分のトークンで乗っ取れる
    const tenantId = verifyOAuthState(state);
    if (!tenantId) return back('google=invalid');
    try {
      const { refreshToken } = await GoogleAdsConnector.exchangeCode(code);
      await this.prisma.withTenant(tenantId, (tx) =>
        tx.mediaConnection.upsert({
          where: { tenantId_platform: { tenantId, platform: 'google_ads' } },
          update: {
            mode: 'oauth', status: 'connected', errorMessage: '',
            refreshTokenEnc: encryptSecret(refreshToken),
            loginCustomerId: (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ?? '').replace(/[^0-9]/g, ''),
            authorizedAt: new Date(),
          },
          create: {
            tenantId, platform: 'google_ads', mode: 'oauth', status: 'connected',
            refreshTokenEnc: encryptSecret(refreshToken),
            loginCustomerId: (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ?? '').replace(/[^0-9]/g, ''),
            authorizedAt: new Date(),
          },
        }),
      );
      return back('google=connected');
    } catch {
      return back('google=failed');
    }
  }

  /** ウィザードStep3: アカウント選択+クライアント割当 → 接続確定+初回同期 */
  @Post(':platform/complete')
  async complete(
    @TenantId() tenantId: string,
    @Param('platform') platform: string,
    @Body()
    body: { accounts?: Array<{ externalAccountId: string; name: string; clientId: string; monthlyBudget?: number }> },
  ): Promise<{ connection: ConnectionDto; sync: SyncResultDto }> {
    const accounts = body?.accounts ?? [];
    if (!ALL_PLATFORMS.includes(platform as Platform) || accounts.length === 0) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        '接続するアカウントが選択されていません。',
        '取り込むアカウントを1件以上選び、割当先クライアントを指定してください。',
      );
    }
    // 既存externalAccountIdは新規作成しない
    const existing = await this.prisma.withTenant(tenantId, (tx) =>
      tx.adAccount.findMany({ where: { platform }, select: { externalAccountId: true } }),
    );
    const existingIds = new Set(existing.map((a) => a.externalAccountId));
    const toCreate = accounts.filter((a) => !existingIds.has(a.externalAccountId));
    await this.billing.assertAccountCapacity(tenantId, toCreate.length);

    const connId = await this.prisma.withTenant(tenantId, async (tx) => {
      for (const a of toCreate) {
        const client = await tx.client.findUnique({ where: { id: a.clientId } });
        if (!client) {
          throw new AppError(
            HttpStatus.BAD_REQUEST,
            '割当先クライアントが見つかりません。',
            'クライアントを選び直してください。',
          );
        }
        await tx.adAccount.create({
          data: {
            tenantId,
            clientId: a.clientId,
            platform,
            externalAccountId: a.externalAccountId,
            name: a.name,
            monthlyBudget: a.monthlyBudget ?? null,
          },
        });
      }
      const conn = await tx.mediaConnection.upsert({
        where: { tenantId_platform: { tenantId, platform } },
        create: { tenantId, platform, status: 'connected', mode: 'mock' },
        update: { status: 'connected' },
      });
      return conn.id;
    });

    const syncResult = await this.sync.sync(tenantId, connId);
    const list = await this.list(tenantId);
    const connection = list.find((c) => c.id === connId)!;
    return { connection, sync: syncResult };
  }

  @Post(':id/sync')
  runSync(@TenantId() tenantId: string, @Param('id') id: string): Promise<SyncResultDto> {
    return this.sync.sync(tenantId, id);
  }

  /** 切断 (実績データとアカウントは保持し、自動同期のみ停止) */
  @Delete(':id')
  async disconnect(@TenantId() tenantId: string, @Param('id') id: string): Promise<{ ok: true }> {
    await this.prisma.withTenant(tenantId, (tx) =>
      tx.mediaConnection.update({ where: { id }, data: { status: 'not_connected' } }),
    );
    return { ok: true };
  }
}
