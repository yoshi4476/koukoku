import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { MetricsService } from './metrics/metrics.service';
import { DashboardController } from './metrics/dashboard.controller';
import { ClientsController } from './clients/clients.controller';
import { PortalController } from './portal/portal.controller';
import { HomeController } from './home/home.controller';
import { LlmService } from './ai/llm.service';
import { AuditService } from './ai/audit.service';
import { AuditController } from './ai/audit.controller';
import { ReportService } from './ai/report.service';
import { ReportController } from './ai/report.controller';
import { CopyService } from './ai/copy.service';
import { CopyController } from './ai/copy.controller';
import { CsvService } from './imports/csv.service';
import { ImportsController } from './imports/imports.controller';
import { AuthService } from './auth/auth.service';
import { TrailService } from './common/trail.service';
import { AuthController } from './auth/auth.controller';
import { OnboardingController } from './onboarding/onboarding.controller';
import { UsageController } from './usage/usage.controller';
import { SchedulerService } from './scheduler/scheduler.service';
import { AlertsService } from './alerts/alerts.service';
import { AlertsController } from './alerts/alerts.controller';
import { ReportExportService } from './exports/report-export.service';
import { BillingService } from './billing/billing.service';
import { BillingController } from './billing/billing.controller';
import { MediaSyncService } from './media-connector/sync.service';
import { ConnectionsController } from './media-connector/connections.controller';
import { ProposalsService } from './proposals/proposals.service';
import { ProposalsController } from './proposals/proposals.controller';
import { PacingController } from './insights/pacing.controller';
import { BenchmarkController } from './insights/benchmark.controller';
import { AbTestsService } from './abtests/abtests.service';
import { AbTestsController } from './abtests/abtests.controller';
import { CalibrationService } from './calibration/calibration.service';
import { KnowledgeService } from './knowledge/knowledge.service';
import { KnowledgeController } from './knowledge/knowledge.controller';
import { EvalController } from './eval/eval.controller';
import { ChangeLogService } from './changelog/changelog.service';
import { ChangeLogController } from './changelog/changelog.controller';
import { SlackController } from './slack/slack.controller';

@Module({
  imports: [PrismaModule],
  controllers: [
    AuthController,
    OnboardingController,
    UsageController,
    AlertsController,
    BillingController,
    ConnectionsController,
    ProposalsController,
    PacingController,
    BenchmarkController,
    AbTestsController,
    KnowledgeController,
    EvalController,
    ChangeLogController,
    SlackController,
    HomeController,
    DashboardController,
    ClientsController,
    PortalController,
    AuditController,
    ReportController,
    CopyController,
    ImportsController,
  ],
  providers: [
    AuthService,
    TrailService,
    AlertsService,
    SchedulerService,
    ReportExportService,
    BillingService,
    MediaSyncService,
    ProposalsService,
    AbTestsService,
    CalibrationService,
    KnowledgeService,
    ChangeLogService,
    MetricsService,
    LlmService,
    AuditService,
    ReportService,
    CopyService,
    CsvService,
  ],
})
export class AppModule {}
