/**
 * 外部連携の有効化状況 (F-48)。各外部サービスの鍵(ENV)が設定済みかを可視化し、
 * 「鍵を入れたら即・有効化を確認」できるようにする。秘密の値は返さず、設定済みか否かのみ。
 */
export interface IntegrationStatusItem {
  key: string;
  label: string;
  category: '実AI' | '画像生成' | '計測' | '実配信' | '連携';
  envVars: string[];
  configured: boolean;
  /** 設定すると有効になること */
  activates: string;
  /** 未設定時のふるまい */
  fallback: string;
}

export interface IntegrationStatusDto {
  items: IntegrationStatusItem[];
  /** 有効化済みの数 / 全体 */
  readyCount: number;
  total: number;
}
