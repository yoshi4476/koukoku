import type { AssetType, ProjectGoal } from './api';
import type { Platform } from './platforms';

/**
 * 制作物タイプの適合判定 (F-36)。
 * その広告の媒体構成・目的に「反映される」制作物タイプだけを扱えるようにし、
 * 広告に必要なものだけを残す。チラシは来店(店頭配布)目的でのみ表示する。
 * (動画は独立タイプにせず、動画が最適な広告では制作物へのアップロードで展開)
 */

const ORDER: AssetType[] = ['copy', 'lp', 'flyer'];

/** この媒体構成・目的で意味のある制作物タイプ (正規の順序で返す) */
export function relevantAssetTypes(platforms: Platform[], goal: ProjectGoal): AssetType[] {
  if (platforms.length === 0) return [...ORDER]; // 媒体未設定なら判定不能=全種
  const set = new Set<AssetType>(['copy', 'lp']); // 広告文・LPはほぼ全構成で有効
  if (goal === 'store') set.add('flyer'); // 来店(店頭配布)目的のときのみチラシ
  return ORDER.filter((t) => set.has(t));
}

/**
 * その広告構成でこの制作物タイプが「反映されない」理由。適合していれば null。
 * 媒体未設定(判定不能)のときは null。
 */
export function assetTypeFitReason(type: AssetType, platforms: Platform[], goal: ProjectGoal): string | null {
  if (platforms.length === 0) return null;
  if (relevantAssetTypes(platforms, goal).includes(type)) return null;
  if (type === 'flyer') return 'オンライン配信には反映されません（店頭配布など来店向け）';
  return 'この配信構成では反映されにくい制作物です';
}
