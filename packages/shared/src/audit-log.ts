/**
 * 監査ログの表示メタ (F-50)。
 * 既存の操作証跡 (audit_trail / F-10) の action 文字列を、UI表示用のラベル・アイコン・重大度に対応づける。
 */

export type AuditSeverity = 'info' | 'notice' | 'high';

export interface AuditActionMeta {
  label: string;
  icon: string;
  severity: AuditSeverity;
}

export const AUDIT_ACTION_META: Record<string, AuditActionMeta> = {
  // 認証
  login: { label: 'ログイン', icon: '🔑', severity: 'info' },
  login_failed: { label: 'ログイン失敗', icon: '🚫', severity: 'high' },
  signup: { label: 'サインアップ', icon: '✨', severity: 'notice' },
  // AI生成・レポート
  audit_run: { label: 'AI法務監査', icon: '⚖️', severity: 'info' },
  report_run: { label: 'レポート生成', icon: '📊', severity: 'info' },
  report_export: { label: 'レポート書き出し', icon: '📄', severity: 'info' },
  report_delivered: { label: 'レポート配信', icon: '📤', severity: 'notice' },
  copy_run: { label: '広告文生成', icon: '✍️', severity: 'info' },
  csv_import: { label: 'CSV取込', icon: '📥', severity: 'info' },
  // A/B・提案・運用
  abtest_create: { label: 'A/Bテスト作成', icon: '🧪', severity: 'info' },
  abtest_conclude: { label: 'A/Bテスト確定', icon: '🏁', severity: 'notice' },
  proposal_create: { label: '改善提案の起票', icon: '💡', severity: 'info' },
  proposal_execute: { label: '提案の適用', icon: '✅', severity: 'high' },
  proposal_requeue: { label: '提案の再キュー', icon: '↩️', severity: 'notice' },
  proposal_reject: { label: '提案の却下', icon: '✋', severity: 'notice' },
  proposal_rollback: { label: '変更のロールバック', icon: '⏪', severity: 'high' },
  media_sync: { label: '媒体データ同期', icon: '🔄', severity: 'info' },
  alert_detection: { label: '異常検知', icon: '🔔', severity: 'notice' },
  knowledge_promote: { label: 'ナレッジ昇格', icon: '📚', severity: 'info' },
  // ガバナンス (F-50で追加記録)
  share_issued: { label: '共有リンク発行', icon: '🔗', severity: 'high' },
  share_revoked: { label: '共有リンク停止', icon: '⛔', severity: 'notice' },
  deal_won: { label: '受注確定', icon: '🎉', severity: 'notice' },
  deal_lost: { label: '失注', icon: '📉', severity: 'info' },
  project_published: { label: '広告公開', icon: '🚀', severity: 'high' },
  asset_deleted: { label: '制作物削除', icon: '🗑️', severity: 'high' },
};

export function auditActionMeta(action: string): AuditActionMeta {
  return AUDIT_ACTION_META[action] ?? { label: action, icon: '•', severity: 'info' };
}

export const AUDIT_SEVERITY_LABEL: Record<AuditSeverity, string> = {
  high: '重要',
  notice: '通知',
  info: '情報',
};

/** 監査ログのフィルタ選択肢 (UI用)。頻出＋ガバナンス系を並べる */
export const AUDIT_FILTERS: { value: string; label: string }[] = [
  { value: '', label: 'すべて' },
  { value: 'proposal_execute', label: '提案の適用' },
  { value: 'proposal_rollback', label: 'ロールバック' },
  { value: 'report_delivered', label: 'レポート配信' },
  { value: 'share_issued', label: '共有リンク発行' },
  { value: 'project_published', label: '広告公開' },
  { value: 'asset_deleted', label: '制作物削除' },
  { value: 'login', label: 'ログイン' },
];
