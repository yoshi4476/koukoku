import type { LawIssue } from '@adgrid/shared';

/**
 * 法規制NG表現辞書 (AIロジック設計 §③ 準拠のドラフト)。
 * 正式リリース前に広告法務専門家の監修必須。四半期更新。
 * 1段目 = この辞書の決定的マッチ / 2段目 = LLMの文脈判定 (実モードのみ)。
 */
interface DictEntry {
  law: string;
  pattern: RegExp;
  severity: 'block' | 'warn';
  reason: string;
  suggestion: string;
}

const DICTIONARY: DictEntry[] = [
  // --- 薬機法 (医薬品的効能の標榜) ---
  {
    law: '薬機法',
    pattern: /(治る|治り|完治|治療できる)/,
    severity: 'block',
    reason: '医薬品以外で疾病の治療効果を標榜する表現は薬機法に抵触するおそれがあります。',
    suggestion: '効能の断定を削除し、使用感や配合成分の事実へ言い換えてください。',
  },
  {
    law: '薬機法',
    pattern: /(シミが消える|しみが消える|ほうれい線が消える)/,
    severity: 'block',
    reason: '身体変化の断定表現は承認された効能の範囲を超えるおそれがあります。',
    suggestion: '「メラニンの生成を抑え、シミ・そばかすを防ぐ」等、区分に応じた承認範囲の表現へ。',
  },
  {
    law: '薬機法',
    pattern: /(痩せる|やせる|脂肪が燃焼|脂肪燃焼効果)/,
    severity: 'block',
    reason: '健康食品等での痩身効果の断定は薬機法・景表法に抵触するおそれがあります。',
    suggestion: '運動・食事管理との併用事実や、栄養成分の事実記載へ言い換えてください。',
  },
  {
    law: '薬機法',
    pattern: /(若返る|若返り)/,
    severity: 'block',
    reason: '身体機能の回復・変化の断定は医薬品的効能の標榜にあたるおそれがあります。',
    suggestion: '「年齢に応じたケア」等の許容される表現へ言い換えてください。',
  },
  {
    law: '薬機法',
    pattern: /(アンチエイジング|デトックス)/,
    severity: 'warn',
    reason: '暗示的な効能表現として行政指導の対象になりうる表現です。',
    suggestion: '「年齢に応じたケア」「すっきりした生活習慣」等への言い換えを検討してください。',
  },
  // --- 景表法 ---
  {
    law: '景表法',
    pattern: /(No\.?1|ナンバーワン|日本一|業界一|最安値|最高峰)/i,
    severity: 'warn',
    reason: '最上級表現は客観的根拠と調査出典の明記がなければ優良誤認となるおそれがあります。',
    suggestion: '調査機関・調査年・範囲を注記できる場合のみ使用し、できなければ削除してください。',
  },
  {
    law: '景表法',
    pattern: /(今だけ|本日限り|残りわずか)/,
    severity: 'warn',
    reason: '常時実施のオファーに期間限定を装うと有利誤認となるおそれがあります。',
    suggestion: '実際の期限がある場合のみ、期限日を明記して使用してください。',
  },
  {
    law: '景表法',
    pattern: /(誰でも|絶対に?|100%|必ず)(効く|効果|成功|満足)/,
    severity: 'block',
    reason: '効果の個人差を無視した断定は優良誤認となるおそれがあります。',
    suggestion: '断定を避け、条件や個人差がある旨が伝わる事実記載にしてください。',
  },
  // --- 金商法ほか金融広告 ---
  {
    law: '金商法等',
    pattern: /(必ず儲かる|絶対儲かる|元本保証|損はしない|損しない)/,
    severity: 'block',
    reason: '断定的判断の提供・利益保証は金融商品取引法等で禁止されています。',
    suggestion: 'リスク表記を伴う事実記載へ変更し、貴社の広告審査体制で確認してください。',
  },
];

/** 1段目: 決定的な辞書スキャン (モック/実モード共通で常時実行) */
export function scanLawDictionary(text: string): LawIssue[] {
  const issues: LawIssue[] = [];
  for (const entry of DICTIONARY) {
    const m = text.match(entry.pattern);
    if (m) {
      issues.push({
        law: entry.law,
        expression: m[0],
        severity: entry.severity,
        reason: entry.reason,
        suggestion: entry.suggestion,
        confidence: 'high',
      });
    }
  }
  return issues;
}
