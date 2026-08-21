/**
 * eval 回帰ランナー (A-2)。プロンプトレジストリ・法規制辞書・文字数・診断ロジックの
 * 品質を機械採点する。CI (pnpm eval) とレビュー時に実行し、基準未達なら exit 1。
 *
 * ゴールデンセットの合格基準 (AIロジック設計 §⑤):
 *   law: 検出率95%以上・block見逃しゼロ・誤検出率10%以下
 *   length: 100%一致
 *   injection: 全件で痕跡なし
 *   audit: 既知課題の検出率100%
 */
import { scanLawDictionary } from '../ai/law-dictionary';
import { widthUnits } from '../ai/copy-limits';
import {
  AUDIT_GOLDEN,
  INJECTION_GOLDEN,
  LAW_GOLDEN,
  LENGTH_GOLDEN,
} from './golden-sets';
import { ruleBasedAuditForEval } from './audit-fixtures';

export interface SuiteResult {
  suite: string;
  passed: number;
  total: number;
  score: number; // 0-1
  threshold: number;
  ok: boolean;
  failures: string[];
}

function lawSuite(): SuiteResult {
  let correct = 0;
  let blockMissed = 0;
  let falsePositive = 0;
  const failures: string[] = [];
  for (const c of LAW_GOLDEN) {
    const issues = scanLawDictionary(c.text);
    const hasBlock = issues.some((i) => i.severity === 'block');
    const hasAny = issues.length > 0;
    const detected: 'block' | 'warn' | 'clean' = hasBlock ? 'block' : hasAny ? 'warn' : 'clean';
    if (detected === c.expect) {
      correct++;
    } else {
      failures.push(`${c.id}: 期待=${c.expect} 実際=${detected} ("${c.text}")`);
      if (c.expect === 'block' && detected !== 'block') blockMissed++;
      if (c.expect === 'clean' && detected !== 'clean') falsePositive++;
    }
  }
  const score = correct / LAW_GOLDEN.length;
  // 合格条件: 全体95%以上 かつ block見逃しゼロ
  const ok = score >= 0.95 && blockMissed === 0;
  if (blockMissed > 0) failures.push(`重大: block見逃し ${blockMissed}件`);
  if (falsePositive > 0) failures.push(`誤検出 ${falsePositive}件`);
  return { suite: 'law-golden', passed: correct, total: LAW_GOLDEN.length, score, threshold: 0.95, ok, failures };
}

function lengthSuite(): SuiteResult {
  let correct = 0;
  const failures: string[] = [];
  for (const c of LENGTH_GOLDEN) {
    const u = widthUnits(c.text);
    if (u === c.expectUnits) correct++;
    else failures.push(`${c.id}: 期待=${c.expectUnits} 実際=${u}`);
  }
  const score = correct / LENGTH_GOLDEN.length;
  return { suite: 'length-golden', passed: correct, total: LENGTH_GOLDEN.length, score, threshold: 1, ok: score >= 1, failures };
}

function injectionSuite(): SuiteResult {
  // 辞書スキャンは非信頼文字列 (キャンペーン名) を「指示」として解釈しない
  // = 出力 (法規制指摘) に注入文字列の痕跡が出ないことを確認
  let safe = 0;
  const failures: string[] = [];
  for (const c of INJECTION_GOLDEN) {
    const issues = scanLawDictionary(c.campaignName);
    const serialized = JSON.stringify(issues);
    const leaked = c.forbidden.some((f) => serialized.includes(f) && !c.campaignName.includes(f));
    // scanは辞書マッチのみ。指示に反応して余計な出力をしないこと (issuesが法規制のみ)
    const followedInstruction = issues.some((i) => !['薬機法', '景表法', '金商法等', '共通'].includes(i.law));
    if (!leaked && !followedInstruction) safe++;
    else failures.push(`${c.id}: 注入痕跡または指示追従を検出`);
  }
  const score = safe / INJECTION_GOLDEN.length;
  return { suite: 'injection-golden', passed: safe, total: INJECTION_GOLDEN.length, score, threshold: 1, ok: score >= 1, failures };
}

function auditSuite(): SuiteResult {
  let correct = 0;
  const failures: string[] = [];
  for (const c of AUDIT_GOLDEN) {
    const result = ruleBasedAuditForEval(c.id);
    const detected = result.findings.some((f) => f.category === c.expectCategory);
    if (detected) correct++;
    else failures.push(`${c.id}: ${c.expectCategory} を検出できず (${c.description})`);
  }
  const score = correct / AUDIT_GOLDEN.length;
  return { suite: 'audit-golden', passed: correct, total: AUDIT_GOLDEN.length, score, threshold: 1, ok: score >= 1, failures };
}

export function runAllSuites(): SuiteResult[] {
  return [lawSuite(), lengthSuite(), injectionSuite(), auditSuite()];
}

export function formatReport(results: SuiteResult[]): string {
  const lines: string[] = ['', '=== ADGRID eval 回帰レポート (A-2) ==='];
  for (const r of results) {
    const mark = r.ok ? 'PASS' : 'FAIL';
    lines.push(
      `[${mark}] ${r.suite.padEnd(18)} ${r.passed}/${r.total} (${Math.round(r.score * 100)}% / 基準 ${Math.round(r.threshold * 100)}%)`,
    );
    for (const f of r.failures) lines.push(`        - ${f}`);
  }
  const allOk = results.every((r) => r.ok);
  lines.push('', allOk ? '✅ 全スイート合格 — プロンプト/辞書のリリース可' : '❌ 未達スイートあり — 修正が必要', '');
  return lines.join('\n');
}
