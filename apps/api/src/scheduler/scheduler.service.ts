import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { PrismaClient } from '@prisma/client';
import { ReportService } from '../ai/report.service';
import { AlertsService } from '../alerts/alerts.service';
import { MediaSyncService } from '../media-connector/sync.service';
import { ProposalsService } from '../proposals/proposals.service';
import { PacingProposalService } from '../insights/pacing-proposal.service';
import type { SessionInfoValue } from '../common/tenant';
import { PrismaService } from '../prisma/prisma.service';
import { daysAgo } from '../metrics/metrics.service';

const QUEUE_NAME = 'weekly-reports';
// JST 月曜 07:00 (= UTC 日曜 22:00) に全テナントの週次レポートを自動生成 (F-14)
const WEEKLY_CRON = '0 22 * * 0';
const ALERT_QUEUE_NAME = 'alert-detection';
// 毎時0分に異常検知 (F-13)。/home からの遅延検知が補完するため厳密性は不要
const ALERT_CRON = '0 * * * *';
const SYNC_QUEUE_NAME = 'media-sync';
// 当日分は3時間毎の増分同期 (別冊D §⑤。MVPは30日洗い替えで代替)
const SYNC_CRON = '30 */3 * * *';
const PACING_QUEUE_NAME = 'pacing-proposals';
// JST 06:30 (= UTC 21:30) に予算逸脱→予算提案を自動下書き (F-51)。自動反映ONのテナントのみ
const PACING_CRON = '30 21 * * *';

// 自動スイープ用の合成セッション (承認者権限。列挙は管理者接続で行い、書込は withTenant/RLS)
const SYSTEM_SESSION: SessionInfoValue = { userId: null, role: 'owner', clientScopeId: null };

const LOCAL_REDIS_URL = 'redis://localhost:56379';
const LOCAL_ADMIN_DB_URL =
  'postgresql://adgrid_admin:adgrid_local_dev@localhost:55433/adgrid?schema=public';

@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);
  private queue: Queue | null = null;
  private worker: Worker | null = null;
  private alertQueue: Queue | null = null;
  private alertWorker: Worker | null = null;
  private syncQueue: Queue | null = null;
  private syncWorker: Worker | null = null;
  private pacingQueue: Queue | null = null;
  private pacingWorker: Worker | null = null;
  private connection: IORedis | null = null;
  // テナント一覧の列挙のみ管理者接続を使う (RLS下のアプリロールでは他テナントが見えないため)。
  // 業務データの読み書きは従来どおり withTenant (RLS) を通す。
  private adminPrisma: PrismaClient | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: ReportService,
    private readonly alerts: AlertsService,
    private readonly mediaSync: MediaSyncService,
    private readonly proposals: ProposalsService,
    private readonly pacingProposals: PacingProposalService,
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

      this.alertQueue = new Queue(ALERT_QUEUE_NAME, { connection: this.connection });
      await this.alertQueue.upsertJobScheduler('hourly', { pattern: ALERT_CRON, tz: 'UTC' });
      this.alertWorker = new Worker(
        ALERT_QUEUE_NAME,
        async () => {
          const r = await this.runAlertDetectionForAllTenants();
          this.logger.log(`alert detection: fired ${r.fired}, suppressed ${r.suppressed}, notified ${r.notified}`);
        },
        { connection: this.connection },
      );
      this.alertWorker.on('failed', (_job, err) =>
        this.logger.error(`alert detection job failed: ${err.message}`),
      );

      this.syncQueue = new Queue(SYNC_QUEUE_NAME, { connection: this.connection });
      await this.syncQueue.upsertJobScheduler('every-3h', { pattern: SYNC_CRON, tz: 'UTC' });
      this.syncWorker = new Worker(
        SYNC_QUEUE_NAME,
        async () => {
          const n = await this.runMediaSyncForAllTenants();
          this.logger.log(`media sync: ${n} connections synced`);
        },
        { connection: this.connection },
      );
      this.syncWorker.on('failed', (_job, err) =>
        this.logger.error(`media sync job failed: ${err.message}`),
      );

      this.pacingQueue = new Queue(PACING_QUEUE_NAME, { connection: this.connection });
      await this.pacingQueue.upsertJobScheduler('daily', { pattern: PACING_CRON, tz: 'UTC' });
      this.pacingWorker = new Worker(
        PACING_QUEUE_NAME,
        async () => {
          const r = await this.runPacingProposalsForAllTenants();
          this.logger.log(`pacing proposals: created ${r.created}, skipped ${r.skipped} across ${r.tenants} tenant(s)`);
        },
        { connection: this.connection },
      );
      this.pacingWorker.on('failed', (_job, err) =>
        this.logger.error(`pacing proposal job failed: ${err.message}`),
      );

      this.logger.log(
        `scheduler ready (${QUEUE_NAME} ${WEEKLY_CRON} / ${ALERT_QUEUE_NAME} ${ALERT_CRON} / ${SYNC_QUEUE_NAME} ${SYNC_CRON} / ${PACING_QUEUE_NAME} ${PACING_CRON} UTC)`,
      );
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

  /** 全テナントの異常検知 (毎時ジョブ)。列挙のみ管理者接続 */
  async runAlertDetectionForAllTenants(): Promise<{ fired: number; suppressed: number; notified: number }> {
    if (!this.adminPrisma) {
      this.adminPrisma = new PrismaClient({
        datasources: { db: { url: process.env.DATABASE_URL ?? LOCAL_ADMIN_DB_URL } },
      });
    }
    const tenants = await this.adminPrisma.tenant.findMany({
      where: { status: 'active' },
      select: { id: true },
    });
    const total = { fired: 0, suppressed: 0, notified: 0 };
    for (const t of tenants) {
      try {
        const r = await this.alerts.runDetection(t.id);
        total.fired += r.fired;
        total.suppressed += r.suppressed;
        total.notified += r.notified;
      } catch (e) {
        this.logger.warn(`alert detection failed tenant=${t.id}: ${String(e)}`);
      }
    }
    return total;
  }

  /** 全テナントの媒体同期。列挙のみ管理者接続 */
  async runMediaSyncForAllTenants(): Promise<number> {
    if (!this.adminPrisma) {
      this.adminPrisma = new PrismaClient({
        datasources: { db: { url: process.env.DATABASE_URL ?? LOCAL_ADMIN_DB_URL } },
      });
    }
    const tenants = await this.adminPrisma.tenant.findMany({
      where: { status: 'active' },
      select: { id: true },
    });
    let total = 0;
    for (const t of tenants) {
      try {
        total += await this.mediaSync.syncAllForTenant(t.id);
      } catch (e) {
        this.logger.warn(`media sync failed tenant=${t.id}: ${String(e)}`);
      }
    }
    return total;
  }

  /**
   * 全テナントの予算逸脱を検出し、承認キューに予算提案を自動下書き (F-51)。
   * 自動ペーシング提案にオプトイン(autoPacingEnabled=true, 既定OFF)したテナントのみ対象。
   * 実適用は人手承認を挟む。列挙のみ管理者接続
   */
  async runPacingProposalsForAllTenants(): Promise<{ created: number; skipped: number; tenants: number }> {
    if (!this.adminPrisma) {
      this.adminPrisma = new PrismaClient({
        datasources: { db: { url: process.env.DATABASE_URL ?? LOCAL_ADMIN_DB_URL } },
      });
    }
    const tenants = await this.adminPrisma.tenant.findMany({
      where: { status: 'active' },
      select: { id: true },
    });
    let created = 0;
    let skipped = 0;
    let active = 0;
    for (const t of tenants) {
      try {
        if (!(await this.proposals.getAutoPacingEnabled(t.id))) continue; // 自動ペーシング提案にオプトインしたテナントのみ (既定OFF)
        active++;
        const r = await this.pacingProposals.sweep(t.id, SYSTEM_SESSION);
        created += r.created;
        skipped += r.skipped;
      } catch (e) {
        // 非エージェント版などは提案作成不可。best-effortで継続
        this.logger.warn(`pacing proposal failed tenant=${t.id}: ${String(e)}`);
      }
    }
    return { created, skipped, tenants: active };
  }

  private async cleanup() {
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
    await this.alertWorker?.close().catch(() => undefined);
    await this.alertQueue?.close().catch(() => undefined);
    await this.syncWorker?.close().catch(() => undefined);
    await this.syncQueue?.close().catch(() => undefined);
    await this.pacingWorker?.close().catch(() => undefined);
    await this.pacingQueue?.close().catch(() => undefined);
    this.connection?.disconnect();
    this.worker = null;
    this.queue = null;
    this.alertWorker = null;
    this.alertQueue = null;
    this.pacingWorker = null;
    this.pacingQueue = null;
    this.connection = null;
  }

  async onModuleDestroy() {
    await this.cleanup();
    await this.adminPrisma?.$disconnect().catch(() => undefined);
  }
}
