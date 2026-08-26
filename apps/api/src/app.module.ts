import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { ClientScopeGuard } from './common/client-scope.guard';
import { SessionGuard } from './common/session.guard';
import { MetricsService } from './metrics/metrics.service';
import { DashboardController } from './metrics/dashboard.controller';
import { ClientsController } from './clients/clients.controller';
import { HomeController } from './home/home.controller';
import { LlmService } from './ai/llm.service';
import { ImageGenService } from './ai/image-gen.service';
import { BriefExtractService } from './projects/brief-extract.service';
import { LaunchService } from './projects/launch.service';
import { KeywordPlanService } from './projects/keyword-plan.service';
import { LaunchSheetService } from './projects/launch-sheet.service';
import { AuditService } from './ai/audit.service';
import { AuditController } from './ai/audit.controller';
import { ReportService } from './ai/report.service';
import { ReportController } from './ai/report.controller';
import { CsvService } from './imports/csv.service';
import { ImportsController } from './imports/imports.controller';
import { AuthService } from './auth/auth.service';
import { PasswordResetService } from './auth/password-reset.service';
import { MailService } from './common/mail.service';
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
import { PacingService } from './insights/pacing.service';
import { PacingProposalService } from './insights/pacing-proposal.service';
import { BenchmarkController } from './insights/benchmark.controller';
import { AbTestsService } from './abtests/abtests.service';
import { AbTestsController } from './abtests/abtests.controller';
import { CalibrationService } from './calibration/calibration.service';
import { EvalController } from './eval/eval.controller';
import { ChangeLogService } from './changelog/changelog.service';
import { ChangeLogController } from './changelog/changelog.controller';
import { SlackController } from './slack/slack.controller';
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
import { TenantConsoleService } from './reseller/tenant-console.service';
import { ResellerController } from './reseller/reseller.controller';
import { PlatformService } from './platform/platform.service';
import { PlatformController } from './platform/platform.controller';
import { PlatformAdminGuard } from './platform/platform-admin.guard';
import { ShareService } from './share/share.service';
import { ShareController, PublicShareController } from './share/share.controller';
import { AuditLogService } from './audit-log/audit-log.service';
import { AuditLogController } from './audit-log/audit-log.controller';
import { LiftService } from './lift/lift.service';
import { LiftController } from './lift/lift.controller';
import { AgentService } from './agent/agent.service';
import { AgentController } from './agent/agent.controller';
import { MeasurementService } from './measurement/measurement.service';
import { MeasurementController } from './measurement/measurement.controller';
import { ConversionService } from './measurement/conversion.service';
import { CollectController, ConversionAdminController } from './measurement/conversion.controller';
import { DealsService } from './deals/deals.service';
import { DealsController } from './deals/deals.controller';
import { IntegrationsController } from './integrations/integrations.controller';

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
    EvalController,
    ChangeLogController,
    SlackController,
    KeywordsController,
    ProjectsController,
    InsightsController,
    AccessController,
    FeedbackController,
    ResellerController,
    PlatformController,
    ShareController,
    PublicShareController,
    AuditLogController,
    LiftController,
    AgentController,
    MeasurementController,
    CollectController,
    ConversionAdminController,
    DealsController,
    IntegrationsController,
    HomeController,
    DashboardController,
    ClientsController,
    AuditController,
    ReportController,
    ImportsController,
  ],
  providers: [
    // 停止中テナントは既存セッションでも通さない (ClientScopeGuard より先に評価される)
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: ClientScopeGuard },
    AuthService,
    PasswordResetService,
    MailService,
    TrailService,
    AlertsService,
    SchedulerService,
    ReportExportService,
    BillingService,
    MediaSyncService,
    ProposalsService,
    PacingService,
    PacingProposalService,
    AbTestsService,
    CalibrationService,
    ChangeLogService,
    KeywordsService,
    ProjectsService,
    InsightsService,
    AccessService,
    FeedbackService,
    ResellerService,
    TenantConsoleService,
    PlatformService,
    PlatformAdminGuard,
    ShareService,
    AuditLogService,
    LiftService,
    AgentService,
    MeasurementService,
    ConversionService,
    DealsService,
    MetricsService,
    LlmService,
    ImageGenService,
    BriefExtractService,
    LaunchService,
    KeywordPlanService,
    LaunchSheetService,
    AuditService,
    ReportService,
    CsvService,
  ],
})
export class AppModule {}
