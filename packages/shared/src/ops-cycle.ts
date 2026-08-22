/**
 * AI自律運用サイクル (F-27)。
 * 「クリエイティブ作成 → 確認・承認 → 出稿・入稿 → 分析・提案 → 改善実行」の
 * 閉ループを可視化し、プロジェクトが今どのフェーズにいて、次に何をすべきか
 * (人が確認・承認するポイント) を1つに束ねる。既存DTOから決定的に算出する純関数。
 */

export type OpsPhaseKey = 'create' | 'approve' | 'publish' | 'analyze' | 'improve';
export type OpsPhaseStatus = 'done' | 'active' | 'attention' | 'todo';

export interface OpsPhase {
  key: OpsPhaseKey;
  label: string;
  icon: string;
  status: OpsPhaseStatus;
  /** 現況の一言 */
  summary: string;
  /** このフェーズでAIが担う作業 (画像の各ノードの内訳に対応) */
  tasks: string[];
  /** 対応する遷移先タブ (プロジェクト内) */
  tab: 'assets' | 'settings' | 'improve' | 'overview';
}

export interface OpsAction {
  label: string;
  reason: string;
  phase: OpsPhaseKey;
  tab: OpsPhase['tab'];
  severity: 'attention' | 'normal';
}

export interface OpsCycle {
  projectId: string;
  projectName: string;
  clientName: string;
  clientId: string;
  phases: OpsPhase[];
  /** 次にやるべき最優先アクション (人の確認・承認ポイント)。無ければ null */
  nextAction: OpsAction | null;
  /** サイクルの健全度 (完了フェーズ比率, 0-100) */
  healthPct: number;
  /** 対応待ちアクション件数 (attention フェーズ数) */
  pendingCount: number;
}

export interface OpsInput {
  projectId: string;
  projectName: string;
  clientName?: string;
  clientId?: string;
  /** 詳細取得時: 制作物の状態内訳 */
  assets?: { status: string }[];
  /** 一覧取得時: 制作物総数・公開数 (assets が無いとき使用) */
  assetCount?: number;
  publishedCount?: number;
  alertCount?: number;
  openFindings?: number;
  /** 月予算 (設定 or 媒体別合計) が入っているか */
  hasBudget?: boolean;
  /** CV計測地点が設定されているか */
  hasCvPoint?: boolean;
  /** 接続済み媒体があるか */
  hasConnectedMedia?: boolean;
  lastReportAt?: string | null;
  cpaDelta?: number | null;
}

const PHASE_META: Record<OpsPhaseKey, { label: string; icon: string; tasks: string[]; tab: OpsPhase['tab'] }> = {
  create: { label: 'クリエイティブ作成', icon: '🎨', tasks: ['訴求軸のコピー生成', 'バナー構成案', '複数パターン生成'], tab: 'assets' },
  approve: { label: '確認・承認', icon: '✅', tasks: ['内容の確認', '審査シミュレーション', '担当者が承認'], tab: 'assets' },
  publish: { label: '広告出稿・入稿', icon: '🚀', tasks: ['クリエイティブ入稿', 'キャンペーン予算設定', 'スケジュール設定'], tab: 'settings' },
  analyze: { label: '分析・提案', icon: '📊', tasks: ['レポート作成', '勝ちパターンの抽出', '予算配分の提案'], tab: 'improve' },
  improve: { label: '改善実行', icon: '⚙️', tasks: ['訴求軸の最適化', '無駄配信の停止', 'ターゲット精度の向上'], tab: 'improve' },
};

export function buildOpsCycle(input: OpsInput): OpsCycle {
  const total = input.assets ? input.assets.length : input.assetCount ?? 0;
  const cnt = (s: string) => (input.assets ? input.assets.filter((a) => a.status === s).length : 0);
  const draft = cnt('draft');
  const review = cnt('review');
  const approved = cnt('approved');
  const published = input.assets ? cnt('published') : input.publishedCount ?? 0;
  const alerts = input.alertCount ?? 0;
  const findings = input.openFindings ?? 0;
  const hasBudget = !!input.hasBudget;
  const hasReport = !!input.lastReportAt;

  const actions: OpsAction[] = [];
  const phases: OpsPhase[] = [];

  // 1. クリエイティブ作成
  {
    const status: OpsPhaseStatus = total === 0 ? 'todo' : approved + published > 0 || review > 0 ? 'done' : 'active';
    const summary = total === 0 ? '制作物がまだありません' : `制作物 ${total}件${draft > 0 ? `（下書き${draft}）` : ''}`;
    phases.push({ key: 'create', ...PHASE_META.create, status, summary });
    if (total === 0) actions.push({ label: '制作物を作成する', reason: 'まず広告文・LP・バナーを用意しましょう（業種に合わせてAI生成できます）', phase: 'create', tab: 'assets', severity: 'attention' });
  }
  // 2. 確認・承認
  {
    const status: OpsPhaseStatus = review > 0 ? 'attention' : approved + published > 0 ? 'done' : total > 0 ? 'active' : 'todo';
    const summary = review > 0 ? `${review}件が承認待ち` : approved > 0 ? `${approved}件が公開待ち` : published > 0 ? '承認済み' : '確認待ちはありません';
    phases.push({ key: 'approve', ...PHASE_META.approve, status, summary });
    if (review > 0) actions.push({ label: `${review}件を確認・承認`, reason: 'レビュー中の制作物があります。内容を確認して承認してください', phase: 'approve', tab: 'assets', severity: 'attention' });
  }
  // 3. 広告出稿・入稿
  {
    const status: OpsPhaseStatus = published > 0 && hasBudget ? 'done' : approved > 0 ? 'attention' : !hasBudget && total > 0 ? 'attention' : 'todo';
    const summary = published > 0 ? `公開中 ${published}件${hasBudget ? '' : '・予算未設定'}` : approved > 0 ? `${approved}件が公開可能` : hasBudget ? '出稿準備中' : '配信設定が未入力';
    phases.push({ key: 'publish', ...PHASE_META.publish, status, summary });
    if (approved > 0) actions.push({ label: `${approved}件を公開する`, reason: '承認済みの制作物を最終確認して公開できます', phase: 'publish', tab: 'assets', severity: 'attention' });
    else if (!hasBudget && total > 0) actions.push({ label: '配信設定を入力する', reason: '月予算・入札・ターゲティングを設定すると出稿できます', phase: 'publish', tab: 'settings', severity: 'normal' });
  }
  // 4. 分析・提案
  {
    const status: OpsPhaseStatus = hasReport ? 'done' : published > 0 ? 'active' : 'todo';
    const summary = hasReport ? '最新レポートあり' : published > 0 ? 'データ取得中・レポート未作成' : '配信後に分析できます';
    phases.push({ key: 'analyze', ...PHASE_META.analyze, status, summary });
    if (published > 0 && !hasReport) actions.push({ label: 'レポートを作成する', reason: '配信データが溜まっています。成果レポートと勝ちパターンを出せます', phase: 'analyze', tab: 'improve', severity: 'normal' });
  }
  // 5. 改善実行
  {
    const attention = findings > 0 || alerts > 0;
    const status: OpsPhaseStatus = attention ? 'attention' : published > 0 ? 'done' : 'todo';
    const summary = findings > 0 ? `未対応の改善 ${findings}件` : alerts > 0 ? `要対応アラート ${alerts}件` : published > 0 ? '順調に運用中' : '配信後に改善できます';
    phases.push({ key: 'improve', ...PHASE_META.improve, status, summary });
    if (findings > 0) actions.push({ label: `改善を実行（${findings}件）`, reason: '診断で見つかった改善ポイントがあります。予算配分・訴求の見直しで成果が伸びます', phase: 'improve', tab: 'improve', severity: 'attention' });
    else if (alerts > 0) actions.push({ label: `アラートに対応（${alerts}件）`, reason: '成果変動のアラートがあります。内容を確認してください', phase: 'improve', tab: 'improve', severity: 'attention' });
  }

  // 次アクションは attention を優先し、フェーズ順（作成→承認→出稿→分析→改善）で先頭
  const order: OpsPhaseKey[] = ['create', 'approve', 'publish', 'analyze', 'improve'];
  actions.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'attention' ? -1 : 1;
    return order.indexOf(a.phase) - order.indexOf(b.phase);
  });
  const doneCount = phases.filter((p) => p.status === 'done').length;
  const pendingCount = phases.filter((p) => p.status === 'attention').length;

  return {
    projectId: input.projectId,
    projectName: input.projectName,
    clientName: input.clientName ?? '',
    clientId: input.clientId ?? '',
    phases,
    nextAction: actions[0] ?? null,
    healthPct: Math.round((doneCount / phases.length) * 100),
    pendingCount,
  };
}
