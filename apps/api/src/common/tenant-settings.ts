import { Tx } from '../prisma/prisma.service';

/**
 * tenant.settings JSON の型付きアクセサ。
 * 更新は read-modify-write の競合を避けるため、同一トランザクション内で
 * 現在値を読んでからマージすること (呼び出し側で tx を渡す)。
 */
export interface TenantSettings {
  slackWebhookUrl?: string;
  applyEnabled?: boolean;
}

export function readSettings(raw: unknown): TenantSettings {
  return (raw ?? {}) as TenantSettings;
}

/** 単一トランザクション内で settings の一部キーだけをマージ更新する */
export async function patchSettings(
  tx: Tx,
  tenantId: string,
  patch: Partial<TenantSettings>,
): Promise<TenantSettings> {
  const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
  const merged = { ...readSettings(tenant?.settings), ...patch };
  await tx.tenant.update({ where: { id: tenantId }, data: { settings: merged } });
  return merged;
}
