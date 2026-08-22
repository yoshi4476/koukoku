/**
 * 日本の広告・販促カレンダー (F-39)。キャンペーンカレンダーで配信期間と重ねて、
 * 需要期・イベントを踏まえた計画を立てられるようにする。
 */
export interface SeasonEvent {
  month: number; // 1-12
  name: string;
  note: string;
  /** 需要の強さ 1(小)〜3(大) */
  weight: 1 | 2 | 3;
}

export const SEASON_EVENTS: SeasonEvent[] = [
  { month: 1, name: '初売り・新年セール', note: '年始需要。福袋・目標設定商材が動く', weight: 3 },
  { month: 1, name: '成人の日', note: '晴れ着・記念・美容需要', weight: 1 },
  { month: 2, name: 'バレンタイン', note: 'ギフト・スイーツ・EC需要', weight: 2 },
  { month: 2, name: '確定申告', note: '士業・会計・金融の相談需要', weight: 2 },
  { month: 3, name: 'ホワイトデー', note: 'ギフト返礼需要', weight: 1 },
  { month: 3, name: '年度末・卒業・引越し', note: '引越し・不動産・新生活準備が最需要期', weight: 3 },
  { month: 4, name: '新生活・入学・入社', note: '新規顧客獲得の好機。金融・通信・教育', weight: 3 },
  { month: 5, name: 'GW / 母の日', note: '旅行・レジャー・ギフト', weight: 2 },
  { month: 6, name: '父の日 / 夏ボーナス', note: '高単価商材・ギフト。梅雨で在宅需要', weight: 2 },
  { month: 7, name: '夏セール・お中元・夏休み', note: '旅行・EC・レジャーの最需要期', weight: 3 },
  { month: 8, name: 'お盆・帰省', note: '帰省・レジャー・地域来店', weight: 2 },
  { month: 9, name: '敬老の日 / シルバーウィーク', note: 'ギフト・旅行・下半期の立ち上げ', weight: 2 },
  { month: 10, name: 'ハロウィン / 行楽', note: 'イベント・飲食・アパレル', weight: 2 },
  { month: 11, name: 'ブラックフライデー', note: 'EC・物販の一大商戦。CPC高騰に注意', weight: 3 },
  { month: 12, name: 'クリスマス・年末商戦・冬ボーナス', note: '年間最大需要期。ギフト・高単価が動く', weight: 3 },
];

/** 指定した月(1-12)のイベント */
export function eventsForMonth(month: number): SeasonEvent[] {
  return SEASON_EVENTS.filter((e) => e.month === month);
}
