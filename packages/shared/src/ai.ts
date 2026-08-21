import { z } from 'zod';

/* ============================================================
 * /audit — AIロジック設計 audit.schema.v1 準拠
 * ============================================================ */

export const AuditCategory = z.enum([
  'measurement',
  'budget',
  'structure',
  'bidding',
  'creative',
  'other',
]);

export const Confidence = z.enum(['high', 'mid', 'low']);

export const MetricCitation = z.object({
  name: z.string(),
  value: z.string(),
  period: z.string(),
});

export const AuditFindingSchema = z.object({
  priority_rank: z.number().int().min(1),
  category: AuditCategory,
  title: z.string().max(60),
  body: z.string(),
  evidence: z.object({
    metrics_cited: z.array(MetricCitation),
    reasoning: z.string(),
  }),
  expected_impact: z.string(),
  risk: z.string(),
  confidence: Confidence,
  impact_level: z.number().int().min(1).max(3),
  ease_level: z.number().int().min(1).max(3),
});

export const AuditResultSchema = z.object({
  summary: z.string().max(400),
  diagnosis_scope: z.object({
    period: z.string(),
    data_sufficiency: z.enum(['full', 'limited']),
    excluded_categories: z.array(z.string()),
  }),
  findings: z.array(AuditFindingSchema).max(10),
  data_requests: z.array(
    z.object({ needed_data: z.string(), reason: z.string() }),
  ),
});

export type AuditFinding = z.infer<typeof AuditFindingSchema>;
export type AuditResult = z.infer<typeof AuditResultSchema>;

export type FindingStatus = 'open' | 'adopted' | 'dismissed';

/* ============================================================
 * /report — 結果 → 要因 → 次のアクション
 * ============================================================ */

export const ReportSectionSchema = z.object({
  kind: z.enum(['result', 'cause', 'action']),
  heading: z.string(),
  body: z.string(),
});

export const ReportResultSchema = z.object({
  executive_summary: z.string(),
  sections: z.array(ReportSectionSchema).min(3),
});

export type ReportResult = z.infer<typeof ReportResultSchema>;

/* ============================================================
 * /copy — 生成候補 + 法規制チェック
 * ============================================================ */

export const LawSeverity = z.enum(['block', 'warn']);

export const LawIssueSchema = z.object({
  law: z.string(),
  expression: z.string(),
  severity: LawSeverity,
  reason: z.string(),
  suggestion: z.string(),
  confidence: Confidence,
});

export const CopyCandidateSchema = z.object({
  appeal_axis: z.string(),
  headline: z.string(),
  description: z.string(),
  law_issues: z.array(LawIssueSchema),
});

export const CopyResultSchema = z.object({
  candidates: z.array(CopyCandidateSchema),
});

export type LawIssue = z.infer<typeof LawIssueSchema>;
export type CopyCandidate = z.infer<typeof CopyCandidateSchema>;
export type CopyResult = z.infer<typeof CopyResultSchema>;

/** 訴求軸フレームワーク (AIロジック設計 §③) */
export const APPEAL_AXES = [
  '便益',
  '損失回避',
  '社会的証明',
  '権威',
  '緊急性・限定',
  '価格・オファー',
  '新規性',
  '簡便性',
] as const;
export type AppealAxis = (typeof APPEAL_AXES)[number];
