import { HttpStatus } from '@nestjs/common';
import { isEditor } from '@adgrid/shared';
import { AppError } from './errors';
import type { SessionInfoValue } from './tenant';

/** データの作成・更新権限を要求する。viewer / 提供先(client) は拒否 (F-25 監査対応) */
export function assertEditor(user: SessionInfoValue): void {
  if (!isEditor(user.role)) {
    throw new AppError(
      HttpStatus.FORBIDDEN,
      '編集の権限がありません。',
      'この操作はオーナー・管理者・運用担当のみ実行できます。',
    );
  }
}
