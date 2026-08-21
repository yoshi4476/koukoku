import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
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

  async onModuleInit() {
    await this.$connect();
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
}
