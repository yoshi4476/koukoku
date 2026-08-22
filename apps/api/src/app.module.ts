import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { ClientScopeGuard } from './common/client-scope.guard';
import { MetricsService } from './metrics/metrics.service';
import { DashboardController } from './metrics/dashboard.controller';
import { ClientsController } from './clients/clients.controller';
import { PortalController } from './portal/portal.controller';
import { HomeController } from './home/home.controller';
import { LlmService } from './ai/llm.service';
import { ImageGenService } from './ai/image-gen.service';
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
import { DashboardsService } from './dashboards/dashboards.service';
import { DashboardsController } from './dashboards/dashboards.controller';
import { KeywordsService } from './keywords/keywords.service';
import { KeywordsController } from './keywords/keywords.controller';
import { ProjectsService } from './projects/projects.service';
import { ProjectsController } from './projects/projects.controller';
import { InsightsService } from './insights/insights.service';
import { InsightsController } from './insights/insights.controller';
import { AccessService } from './access/access.service';
import { AccessController } from './access/access.controller';
import { FeedbackService } from './feedback/feedback.service';
import { FeedbackController } from './feedback/feedback.controller';
import { ResellerService } from './reseller/reseller.service';
import { ResellerController } from './reseller/reseller.controller';
import { ShareService } from './share/share.service';
import { ShareController, PublicShareController } from './share/share.controller';
import { LiftService } from './lift/lift.service';
import { LiftController } from './lift/lift.controller';
import { AgentService } from './agent/agent.service';
import { AgentController } from './agent/agent.controller';
import { MeasurementService } from './measurement/measurement.service';
import { MeasurementController } from './measurement/measurement.controller';

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
    DashboardsController,
    KeywordsController,
    ProjectsController,
    InsightsController,
    AccessController,
    FeedbackController,
    ResellerController,
    ShareController,
    PublicShareController,
    LiftController,
    AgentController,
    MeasurementController,
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
    { provide: APP_GUARD, useClass: ClientScopeGuard },
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
    DashboardsService,
    KeywordsService,
    ProjectsService,
    InsightsService,
    AccessService,
    FeedbackService,
    ResellerService,
    ShareService,
    LiftService,
    AgentService,
    MeasurementService,
    MetricsService,
    LlmService,
    ImageGenService,
    AuditService,
    ReportService,
    CopyService,
    CsvService,
  ],
})
export class AppModule {}
