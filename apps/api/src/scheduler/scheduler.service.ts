import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { PrismaClient } from '@prisma/client';
import { ReportService } from '../ai/report.service';
import { PrismaService } from '../prisma/prisma.service';
import { daysAgo } from '../metrics/metrics.service';

const QUEUE_NAME = 'weekly-reports';
// JST 月曜 07:00 (= UTC 日曜 22:00) に全テナントの週次レポートを自動生成 (F-14)
const WEEKLY_CRON = '0 22 * * 0';

const LOCAL_REDIS_URL = 'redis://localhost:56379';
const LOCAL_ADMIN_DB_URL =
  'postgresql://adgrid_admin:adgrid_local_dev@localhost:55433/adgrid?schema=public';

@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;
  private connection: IORedis | null = null;
  // テナント一覧の列挙のみ管理者接続を使う (RLS下のアプリロールでは他テナントが見えないため)。
  // 業務データの読み書きは従来どおり withTenant (RLS) を通す。
  private adminPrisma: PrismaClient | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: ReportService,
  ) {}

  async onModuleInit() {
    if (process.env.ENABLE_SCHEDULER === 'false') {
      this.logger.log('scheduler disabled (ENABLE_SCHEDULER=false)');
      return;
    }
    const url = process.env.REDIS_URL ?? LOCAL_REDIS_URL;
    try {
      this.connection = new IORedis(url, {
        maxRetriesPerRequest: null,
        lazyConnect: true,
        retryStrategy: (times) => (times > 3 ? null : 1000),
      });
      this.connection.on('error', (e) => this.logger.warn(`redis: ${e.message}`));
      await this.connection.connect();

      this.queue = new Queue(QUEUE_NAME, { connection: this.connection });
      await this.queue.upsertJobScheduler('weekly', { pattern: WEEKLY_CRON, tz: 'UTC' });

      this.worker = new Worker(
        QUEUE_NAME,
        async () => {
          const result = await this.runWeeklyForAllTenants();
          this.logger.log(`weekly reports generated: ${result.generated} (skipped ${result.skipped})`);
        },
        { connection: this.connection },
      );
      this.worker.on('failed', (_job, err) => this.logger.error(`weekly job failed: ${err.message}`));
      this.logger.log(`scheduler ready (${QUEUE_NAME}, cron ${WEEKLY_CRON} UTC)`);
    } catch (e) {
      this.logger.warn(`scheduler disabled (redis unavailable): ${String(e)}`);
      await this.cleanup();
    }
  }

  /** 全テナント×全クライアントの今週分レポートを生成 (存在すればスキップ)。手動実行も可 */
  async runWeeklyForAllTenants(): Promise<{ generated: number; skipped: number; failed: number }> {
    if (!this.adminPrisma) {
      this.adminPrisma = new PrismaClient({
        datasources: { db: { url: process.env.DATABASE_URL ?? LOCAL_ADMIN_DB_URL } },
      });
    }
    const tenants = await this.adminPrisma.tenant.findMany({
      where: { status: 'active' },
      select: { id: true },
    });

    let generated = 0;
    let skipped = 0;
    let failed = 0;
    for (const t of tenants) {
      const clients = await this.prisma.withTenant(t.id, (tx) =>
        tx.client.findMany({ where: { status: 'active' }, select: { id: true } }),
      );
      for (const c of clients) {
        try {
          const [hasData, recent] = await this.prisma.withTenant(t.id, async (tx) => {
            const fact = await tx.factAdPerformance.findFirst({
              where: { adAccount: { clientId: c.id }, date: { gte: daysAgo(6) } },
              select: { date: true },
            });
            const report = await tx.report.findFirst({
              where: { clientId: c.id, createdAt: { gte: daysAgo(6) } },
              select: { id: true },
            });
            return [fact !== null, report !== null] as const;
          });
          if (!hasData || recent) {
            skipped++;
            continue;
          }
          await this.reports.run(t.id, c.id, 'weekly');
          generated++;
        } catch (e) {
          failed++;
          this.logger.warn(`weekly report failed tenant=${t.id} client=${c.id}: ${String(e)}`);
        }
      }
    }
    return { generated, skipped, failed };
  }

  private async cleanup() {
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
    this.connection?.disconnect();
    this.worker = null;
    this.queue = null;
    this.connection = null;
  }

  async onModuleDestroy() {
    await this.cleanup();
    await this.adminPrisma?.$disconnect().catch(() => undefined);
  }
}
