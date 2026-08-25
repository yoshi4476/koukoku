import { Controller, Get, HttpStatus, Post } from '@nestjs/common';
import type { PacingDto, PacingSweepDto } from '@adgrid/shared';
import { isApprover } from '@adgrid/shared';
import { SessionInfo, SessionInfoValue, TenantId } from '../common/tenant';
import { AppError } from '../common/errors';
import { PacingService } from './pacing.service';
import { PacingProposalService } from './pacing-proposal.service';

@Controller('pacing')
export class PacingController {
  constructor(
    private readonly pacing: PacingService,
    private readonly pacingProposals: PacingProposalService,
  ) {}

  /** 予算ペーシング予測 (B-4)。月予算のあるアカウントの着地予測と推奨日予算 */
  @Get()
  pacingList(@TenantId() tenantId: string): Promise<PacingDto[]> {
    return this.pacing.compute(tenantId);
  }

  /** 予算逸脱アカウントを検出し、承認キューに予算提案を自動下書きする (F-51)。owner/admin 限定 */
  @Post('propose')
  propose(@TenantId() tenantId: string, @SessionInfo() user: SessionInfoValue): Promise<PacingSweepDto> {
    if (!isApprover(user.role)) {
      throw new AppError(HttpStatus.FORBIDDEN, '提案作成の権限がありません。', 'オーナーまたは管理者で操作してください。');
    }
    return this.pacingProposals.sweep(tenantId, user);
  }
}
