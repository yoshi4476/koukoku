import { HttpStatus, Injectable } from '@nestjs/common';
import { PLANS } from '@adgrid/shared';
import type { BillingDto, PlanDef, PlanId } from '@adgrid/shared';
import { PrismaService } from '../prisma/prisma.service';
import { AppError } from '../common/errors';

@Injectable()
export class BillingService {
  constructor(private readonly prisma: PrismaService) {}

  private planOf(planId: string): PlanDef {
    return PLANS[(planId as PlanId) in PLANS ? (planId as PlanId) : 'starter'];
  }

  async getBilling(tenantId: string): Promise<BillingDto> {
    const [tenant, accountsUsed] = await this.prisma.withTenant(tenantId, (tx) =>
      Promise.all([
        tx.tenant.findUnique({ where: { id: tenantId } }),
        tx.adAccount.count({ where: { isBillable: true } }),
      ]),
    );
    const plan = this.planOf(tenant?.plan ?? 'starter');
    return {
      plan,
      accountsUsed,
      accountLimit: plan.accountLimit,
      // Stripe接続 (F-08) までは全テナントをトライアル扱い
      billingConfigured: Boolean(process.env.STRIPE_SECRET_KEY),
    };
  }

  /** アカウント追加前の上限チェック (要件書 §⑦ プラン上限制御) */
  async assertAccountCapacity(tenantId: string, adding: number): Promise<void> {
    const billing = await this.getBilling(tenantId);
    if (billing.accountLimit === null) return;
    if (billing.accountsUsed + adding > billing.accountLimit) {
      throw new AppError(
        HttpStatus.PAYMENT_REQUIRED,
        `${billing.plan.label}プランの広告アカウント上限 (${billing.accountLimit}件) に達しています。現在${billing.accountsUsed}件。`,
        '設定画面からプランのアップグレードをご検討ください。不要になったアカウントの削除でも枠を空けられます。',
      );
    }
  }
}
