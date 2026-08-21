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

@Module({
  imports: [PrismaModule],
  controllers: [
    AuthController,
    OnboardingController,
    UsageController,
    AlertsController,
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
    MetricsService,
    LlmService,
    AuditService,
    ReportService,
    CopyService,
    CsvService,
  ],
})
export class AppModule {}
