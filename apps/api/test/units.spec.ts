import { describe, expect, it } from 'vitest';
import { isApprover, twoProportionPValue, verdictHigherBetter, verdictLowerBetter, benchmarkFor } from '@adgrid/shared';
import { limitsFor, widthUnits } from '../src/ai/copy-limits';
import { scanLawDictionary } from '../src/ai/law-dictionary';
import { normalizeHeader, parseCsv, parseDate, parseNumber } from '../src/imports/csv.service';
import { readSettings } from '../src/common/tenant-settings';
import { runAllSuites } from '../src/eval/runner';
import { metricValue } from '../src/dashboards/dashboards.service';

describe('widthUnits (全角=2/半角=1)', () => {
  it('半角英数は1、全角は2で数える', () => {
    expect(widthUnits('abc123')).toBe(6);
    expect(widthUnits('広告')).toBe(4);
    expect(widthUnits('AB広告')).toBe(6);
  });
  it('半角カナは1で数える', () => {
    expect(widthUnits('ｱｲｳ')).toBe(3);
  });
  it('Google RSA 見出し上限 (30ユニット=全角15字)', () => {
    const limits = limitsFor('google_ads');
    expect(widthUnits('あ'.repeat(15))).toBe(limits.headlineUnits);
    expect(widthUnits('あ'.repeat(16))).toBeGreaterThan(limits.headlineUnits);
  });
});

describe('scanLawDictionary (薬機法/景表法/金商法)', () => {
  it('薬機法blockを検出し修正案を返す', () => {
    const issues = scanLawDictionary('飲むだけで痩せるサプリ');
    expect(issues.some((i) => i.law === '薬機法' && i.severity === 'block')).toBe(true);
    expect(issues[0].suggestion.length).toBeGreaterThan(0);
  });
  it('景表法の最上級表現はwarn', () => {
    const issues = scanLawDictionary('顧客満足度No.1の実績');
    expect(issues.some((i) => i.law === '景表法' && i.severity === 'warn')).toBe(true);
  });
  it('金融の断定的利益保証はblock', () => {
    const issues = scanLawDictionary('元本保証で安心の投資');
    expect(issues.some((i) => i.severity === 'block')).toBe(true);
  });
  it('適法な表現は誤検出しない', () => {
    expect(scanLawDictionary('うるおいを与える薬用クリーム。資料請求はこちら。')).toHaveLength(0);
  });
});

describe('権限・設定 (承認フローのガード)', () => {
  it('承認者は owner/admin のみ', () => {
    expect(isApprover('owner')).toBe(true);
    expect(isApprover('admin')).toBe(true);
    expect(isApprover('operator')).toBe(false);
    expect(isApprover('viewer')).toBe(false);
  });
  it('kill switch: applyEnabled は false の明示時のみ無効 (既定は有効)', () => {
    expect(readSettings({ applyEnabled: false }).applyEnabled).toBe(false);
    expect(readSettings({}).applyEnabled).toBeUndefined(); // undefined→呼出側で「有効」扱い
    expect(readSettings(null).applyEnabled).toBeUndefined();
    // 文字列 'false' 等の壊れた値は boolean false ではないので「無効化」に倒れない
    expect(readSettings({ applyEnabled: 'false' }).applyEnabled as unknown).not.toBe(false);
  });
});

describe('A/Bテスト統計 (B-3)', () => {
  it('明確な差は有意 (p<0.05)', () => {
    // 1000クリックでCVR 5% vs 10% は有意差あり
    const p = twoProportionPValue(50, 1000, 100, 1000);
    expect(p).not.toBeNull();
    expect(p!).toBeLessThan(0.05);
  });
  it('わずかな差・小サンプルは有意でない', () => {
    const p = twoProportionPValue(5, 100, 6, 100);
    expect(p!).toBeGreaterThan(0.05);
  });
  it('分母0はnull', () => {
    expect(twoProportionPValue(0, 0, 5, 100)).toBeNull();
  });
});

describe('A/B勝者の再計算ロジック (B-1昇格)', () => {
  // 昇格時の勝者はレート比較で決まる (DBのwinnerフィールドに依存しない)
  const winnerByRate = (aNum: number, aDen: number, bNum: number, bDen: number) => {
    const aRate = aDen > 0 ? aNum / aDen : 0;
    const bRate = bDen > 0 ? bNum / bDen : 0;
    return bRate >= aRate ? 'b' : 'a';
  };
  it('CVRが高いアームが勝者', () => {
    expect(winnerByRate(50, 1000, 88, 1000)).toBe('b');
    expect(winnerByRate(90, 1000, 50, 1000)).toBe('a');
  });
  it('リフトは勝者/敗者のレート差', () => {
    const aRate = 50 / 1000;
    const bRate = 88 / 1000;
    const lift = +(((bRate - aRate) / aRate) * 100).toFixed(1);
    expect(lift).toBe(76);
  });
});

describe('業種ベンチマーク判定 (A-3)', () => {
  it('相場+20%以上はgood、-20%以下はpoor (高いほど良い指標)', () => {
    expect(verdictHigherBetter(2.5, 2.0)).toBe('good');
    expect(verdictHigherBetter(1.5, 2.0)).toBe('poor');
    expect(verdictHigherBetter(2.0, 2.0)).toBe('avg');
    expect(verdictHigherBetter(null, 2.0)).toBe('na');
  });
  it('CPAは低いほど良い', () => {
    expect(verdictLowerBetter(3000, 5000)).toBe('good');
    expect(verdictLowerBetter(7000, 5000)).toBe('poor');
  });
  it('未知業種はotherにフォールバック', () => {
    expect(benchmarkFor('unknown').code).toBe('other');
    expect(benchmarkFor('ec').label).toBe('EC・物販');
  });
});

describe('カスタムダッシュボードの指標計算 (B-5)', () => {
  const t = { cost: 100000, impressions: 500000, clicks: 5000, conversions: 50, conversionValue: 400000 };
  it('派生指標を正しく計算', () => {
    expect(metricValue('cost', t)).toBe(100000);
    expect(metricValue('cpa', t)).toBe(2000); // 100000/50
    expect(metricValue('ctr', t)).toBe(1); // 5000/500000*100
    expect(metricValue('cvr', t)).toBe(1); // 50/5000*100
    expect(metricValue('roas', t)).toBe(400); // 400000/100000*100
  });
  it('ゼロ除算はnull', () => {
    expect(metricValue('cpa', { ...t, conversions: 0 })).toBeNull();
    expect(metricValue('ctr', { ...t, impressions: 0 })).toBeNull();
  });
});

describe('eval回帰 (A-2 ゴールデンセット)', () => {
  const suites = runAllSuites();
  for (const s of suites) {
    it(`${s.suite} が基準を満たす (${s.passed}/${s.total})`, () => {
      expect(s.ok, s.failures.join('; ')).toBe(true);
    });
  }
});

describe('CSVパーサ', () => {
  it('引用符内のカンマ・改行・二重引用符を扱える', () => {
    const rows = parseCsv('a,"1,234","x""y"\nb,2,z\n');
    expect(rows).toEqual([
      ['a', '1,234', 'x"y'],
      ['b', '2', 'z'],
    ]);
  });
  it('空行を無視する', () => {
    expect(parseCsv('a,b\n\n\nc,d\n')).toHaveLength(2);
  });
  it('金額のカンマ・¥・空白を除去して数値化', () => {
    expect(parseNumber('"¥13,500"')).toBe(13500);
    expect(parseNumber(undefined)).toBe(0);
    expect(parseNumber('abc')).toBe(0);
  });
  it('日付はUTC深夜に固定 (YYYY/MM/DD・YYYY-MM-DD)', () => {
    const d = parseDate('2026/08/21');
    expect(d?.toISOString()).toBe('2026-08-21T00:00:00.000Z');
    expect(parseDate('2026-08-05')?.toISOString()).toBe('2026-08-05T00:00:00.000Z');
    expect(parseDate('8月21日')).toBeNull();
  });
  it('ヘッダ正規化は空白・引用符・全角空白を除去し小文字化', () => {
    expect(normalizeHeader(' "クリック数" ')).toBe('クリック数');
    expect(normalizeHeader('Impressions')).toBe('impressions');
  });
});
