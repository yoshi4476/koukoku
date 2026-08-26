import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

export type Tx = Prisma.TransactionClient;

// .env 未作成でもローカル開発が動くデフォルト (docker-compose と一致)
const LOCAL_APP_DB_URL =
  'postgresql://adgrid_app:adgrid_app_local@localhost:55433/adgrid?schema=public';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      datasources: {
        db: { url: process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL ?? LOCAL_APP_DB_URL },
      },
    });
  }

  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit() {
    await this.$connect();
    await this.assertTenantIsolation();
  }

  /**
   * fail-closed: テナント分離(RLS)が本当に効いているかを起動時に実測する。
   *
   * 属性チェックだけでは不十分。PostgreSQLでは **テーブル所有者はRLSを迂回する** ため、
   * 所有者ロール(Supabaseの postgres など)で接続すると BYPASSRLS が無くてもRLSが効かない。
   * そこで存在しないテナントIDを設定して実際に行が見えないかを確認する。
   */
  private async assertTenantIsolation(): Promise<void> {
    const fail = (msg: string) => {
      if (process.env.NODE_ENV === 'production') throw new Error(msg);
      this.logger.error(msg); // 開発では起動を継続するが強く警告する
    };
    try {
      const roles = await this.$queryRaw<Array<{ current_user: string; bypassrls: boolean }>>(
        Prisma.sql`SELECT current_user, rolbypassrls AS bypassrls FROM pg_roles WHERE rolname = current_user`,
      );
      const role = roles[0];
      if (role?.bypassrls) {
        return fail(
          `致命的: アプリDBロール "${role.current_user}" は BYPASSRLS を持つためRLSが無効です。` +
            'APP_DATABASE_URL に非特権ロール(adgrid_app)を設定してください。',
        );
      }

      // 実測: 存在しないテナントを設定した状態で、RLS対象テーブルが1件も見えないこと
      const probe = await this.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', '__rls_probe_no_such_tenant__', true)`;
        const r = await tx.$queryRaw<Array<{ n: bigint }>>(
          Prisma.sql`SELECT count(*)::bigint AS n FROM clients`,
        );
        return Number(r[0]?.n ?? 0);
      });
      if (probe > 0) {
        return fail(
          `致命的: テナント分離が機能していません (存在しないテナントで ${probe} 件が参照可能)。` +
            `ロール "${role?.current_user}" がテーブル所有者の可能性があります。` +
            'アプリは所有者以外の非特権ロール(adgrid_app)で接続してください。',
        );
      }
      this.logger.log(`テナント分離OK (role=${role?.current_user})`);
    } catch (e) {
      if (process.env.NODE_ENV === 'production') throw e;
      this.logger.warn(`テナント分離の検証をスキップ: ${(e as Error).message}`);
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * RLSコンテキスト付きトランザクション。
   * app.tenant_id をトランザクションローカルに設定し、RLSポリシーで
   * 他テナント行への到達をDB層で遮断する (要件書 §④ 二重防御)。
   * 注意: LLM呼出などの長時間処理はこの中に入れない (txタイムアウト)。
   */
  withTenant<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return fn(tx);
    });
  }

  /**
   * SaaS運営者(システム管理者)専用のコンテキスト (F-61)。
   *
   * 開くのは tenants テーブルの行の可視性だけで、業務データ(clients/projects/実績等)は
   * 従来どおり分離されたまま。個別テナントの中身を集計するには withTenant で入り直す。
   * これにより「運営者は契約状況を把握できるが、顧客の広告データを素通しで読めはしない」を保つ。
   *
   * 呼び出し元は必ず PlatformAdminGuard を通すこと。
   */
  withPlatformAdmin<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.platform_admin', 'on', true)`;
      return fn(tx);
    });
  }
}
