import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  Edition,
  PlatformConsoleDto,
  PlatformHealthDto,
  PlatformHealthItem,
  PlatformTenantDto,
} from '@adgrid/shared';
import { TENANT_PLANS } from '@adgrid/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/errors';
import { TrailService } from '../common/trail.service';
import { SessionGuard } from '../common/session.guard';
import { daysAgo } from '../metrics/metrics.service';
import type { PlatformAdminValue } from './platform-admin.guard';

/**
 * システム管理 (F-61)。SaaS運営者が全テナントを横断して把握・操作する。
 *
 * 対象は「提供元(リセラー)が発行した子テナント」だけでなく、
 * サインアップから自分で登録した**直接契約のお客さん**も含む全テナント。
 *
 * データ到達の考え方:
 *   - tenants 行の一覧は withPlatformAdmin (RLSを tenants のみ開く)
 *   - 各テナントの利用状況は withTenant で1件ずつ入って集計する
 * 業務データを素通しで読める経路は作らない。運営者でも「入った」記録が残る形にする。
 */
@Injectable()
export class PlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trail: TrailService,
  ) {}

  async console(): Promise<PlatformConsoleDto> {
    const rows = await this.prisma.withPlatformAdmin((tx) =>
      tx.tenant.findMany({ orderBy: { createdAt: 'desc' } }),
    );
    const nameById = new Map(rows.map((t) => [t.id, t.name]));

    const since = daysAgo(29);
    const until = daysAgo(0);
    const tenants: PlatformTenantDto[] = [];

    for (const t of rows) {
      const owner = await this.prisma.tenantMember.findFirst({
        where: { tenantId: t.id, role: 'owner' },
        include: { user: true },
      });
      const userCount = await this.prisma.tenantMember.count({ where: { tenantId: t.id } });

      // 各テナントの文脈に入って集計する (RLSを効かせたまま数える)
      const usage = await this.prisma.withTenant(t.id, async (tx) => {
        const [clientCount, projectCount, accountCount] = await Promise.all([
          tx.client.count(),
          tx.project.count(),
          tx.adAccount.count(),
        ]);
        const metrics = await tx.factAdPerformance.aggregate({
          where: { date: { gte: since, lte: until } },
          _sum: { cost: true, conversions: true },
        });
        const ai = await tx.llmCall.aggregate({
          where: { createdAt: { gte: since } },
          _sum: { costJpy: true },
        });
        const lastTrail = await tx.auditTrail.findFirst({
          orderBy: { createdAt: 'desc' },
          select: { createdAt: true },
        });
        return {
          clientCount,
          projectCount,
          accountCount,
          cost: Number(metrics._sum.cost ?? 0),
          conversions: Number(metrics._sum.conversions ?? 0),
          aiCost: Number(ai._sum.costJpy ?? 0),
          lastActiveAt: lastTrail?.createdAt ?? null,
        };
      });

      tenants.push({
        id: t.id,
        name: t.name,
        edition: (t.edition as Edition) ?? 'agency',
        status: t.status,
        plan: t.plan,
        parentTenantId: t.parentTenantId,
        parentTenantName: t.parentTenantId ? nameById.get(t.parentTenantId) ?? null : null,
        adminEmail: owner?.user.email ?? '',
        createdAt: t.createdAt.toISOString(),
        clientCount: usage.clientCount,
        projectCount: usage.projectCount,
        accountCount: usage.accountCount,
        userCount,
        cost30d: Math.round(usage.cost),
        conversions30d: +usage.conversions.toFixed(1),
        aiCostJpy30d: +usage.aiCost.toFixed(2),
        lastActiveAt: usage.lastActiveAt?.toISOString() ?? null,
        onboarded: usage.clientCount > 0 && usage.accountCount > 0,
        active30d: usage.lastActiveAt != null && usage.lastActiveAt >= since,
      });
    }

    const planCounts: Record<string, number> = {};
    for (const t of tenants) planCounts[t.plan] = (planCounts[t.plan] ?? 0) + 1;

    return {
      tenants,
      overview: {
        tenantCount: tenants.length,
        activeCount: tenants.filter((t) => t.status === 'active').length,
        suspendedCount: tenants.filter((t) => t.status !== 'active').length,
        active30dCount: tenants.filter((t) => t.active30d).length,
        // 立ち上がっていない = 稼働中なのにクライアント未登録か媒体未接続。解約予備軍
        stalledCount: tenants.filter((t) => t.status === 'active' && !t.onboarded).length,
        newIn30d: tenants.filter((t) => new Date(t.createdAt) >= since).length,
        directCount: tenants.filter((t) => t.parentTenantId == null).length,
        resoldCount: tenants.filter((t) => t.parentTenantId != null).length,
        userCount: tenants.reduce((s, t) => s + t.userCount, 0),
        clientCount: tenants.reduce((s, t) => s + t.clientCount, 0),
        projectCount: tenants.reduce((s, t) => s + t.projectCount, 0),
        cost30d: tenants.reduce((s, t) => s + t.cost30d, 0),
        aiCostJpy30d: +tenants.reduce((s, t) => s + t.aiCostJpy30d, 0).toFixed(2),
        planCounts,
      },
    };
  }

  private async findTenant(tenantId: string) {
    const t = await this.prisma.withPlatformAdmin((tx) => tx.tenant.findUnique({ where: { id: tenantId } }));
    if (!t) {
      throw new AppError(HttpStatus.NOT_FOUND, 'テナントが見つかりません。', '一覧から選び直してください。');
    }
    return t;
  }

  /** 利用の停止/再開。停止するとそのテナントの全員がログインできなくなる */
  async setStatus(admin: PlatformAdminValue, tenantId: string, status: 'active' | 'suspended') {
    await this.findTenant(tenantId);
    await this.prisma.withPlatformAdmin((tx) => tx.tenant.update({ where: { id: tenantId }, data: { status } }));
    // 既存セッションにも即座に効かせる (キャッシュを残すと最大30秒使い続けられる)
    SessionGuard.invalidateTenant(tenantId);
    // 記録は対象テナント側に残す (顧客側の監査ログからも経緯が追えるようにする)
    await this.trail.record({
      tenantId,
      userId: admin.userId,
      action: status === 'active' ? 'tenant_resumed' : 'tenant_suspended',
      resource: `platform:${admin.email}`,
    });
    return { ok: true as const, status };
  }

  /** 契約プランの変更。請求区分と機能上限の基準になる */
  async setPlan(admin: PlatformAdminValue, tenantId: string, plan: string) {
    if (!TENANT_PLANS.includes(plan as (typeof TENANT_PLANS)[number])) {
      throw new AppError(
        HttpStatus.BAD_REQUEST,
        'プランの指定が正しくありません。',
        `${TENANT_PLANS.join(' / ')} のいずれかを指定してください。`,
      );
    }
    await this.findTenant(tenantId);
    await this.prisma.withPlatformAdmin((tx) => tx.tenant.update({ where: { id: tenantId }, data: { plan } }));
    await this.trail.record({
      tenantId,
      userId: admin.userId,
      action: 'tenant_plan_changed',
      resource: `${plan} / platform:${admin.email}`,
    });
    return { ok: true as const, plan };
  }

  /** 障害時の一次切り分け。DBロール・RLS・実行基盤・外部連携をまとめて見る */
  async health(): Promise<PlatformHealthDto> {
    const has = (...keys: string[]) => keys.every((k) => !!process.env[k]);
    let dbRole = '不明';
    let rlsEnforced = false;
    try {
      const roles = await this.prisma.$queryRaw<Array<{ current_user: string; bypassrls: boolean }>>(
        Prisma.sql`SELECT current_user, rolbypassrls AS bypassrls FROM pg_roles WHERE rolname = current_user`,
      );
      dbRole = roles[0]?.current_user ?? '不明';
      if (!roles[0]?.bypassrls) {
        // 存在しないテナントで業務テーブルが見えないことを実測する
        const probe = await this.prisma.withTenant('__platform_health_probe__', async (tx) => {
          const r = await tx.$queryRaw<Array<{ n: bigint }>>(Prisma.sql`SELECT count(*)::bigint AS n FROM clients`);
          return Number(r[0]?.n ?? 0);
        });
        rlsEnforced = probe === 0;
      }
    } catch {
      rlsEnforced = false;
    }

    const items: PlatformHealthItem[] = [
      {
        key: 'anthropic', label: 'Claude（実AI）', optional: false, ok: has('ANTHROPIC_API_KEY'),
        detail: '広告文・AI診断・レポート生成。未設定でもテンプレートで動作します',
      },
      {
        key: 'google_ads', label: 'Google広告（実配信）', optional: false,
        ok: has('GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET'),
        detail: '実アカウント接続・実データ同期・実入稿。未設定はデモ接続',
      },
      {
        key: 'imagen', label: '画像生成（Imagen）', optional: true,
        ok: !!(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
        detail: '制作物のAI画像生成。未設定でも自動バナーで代替できます',
      },
      {
        key: 'ga4_mp', label: 'GA4 サーバーCV', optional: true, ok: has('GA4_API_SECRET'),
        detail: 'サーバー側からGA4へCV送信。計測の取りこぼしを補います',
      },
      {
        key: 'meta_capi', label: 'Meta CAPI', optional: true, ok: has('META_CAPI_ACCESS_TOKEN'),
        detail: 'サーバー側からMetaへCV送信。iOS/クッキー制限に強くなります',
      },
      {
        key: 'slack', label: 'Slack連携', optional: true, ok: has('SLACK_SIGNING_SECRET'),
        detail: 'Slackコマンドの署名検証。未設定だと本番で受け付けません',
      },
      {
        key: 'token_key', label: '接続トークン暗号化キー', optional: false, ok: has('TOKEN_ENCRYPTION_KEY'),
        detail: '媒体のリフレッシュトークンを暗号化して保存します',
      },
      {
        key: 'auth_secret', label: 'セッション署名キー', optional: false, ok: has('AUTH_SECRET'),
        detail: 'ログインセッションの署名。未設定だと本番では起動しません',
      },
    ];

    return {
      dbRole,
      rlsEnforced,
      schedulerEnabled: process.env.ENABLE_SCHEDULER !== 'false',
      nodeEnv: process.env.NODE_ENV ?? 'development',
      items,
    };
  }
}
