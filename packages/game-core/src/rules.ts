import type { DieValue, Phase, PlayerCount } from './types';

export const PHASES: readonly Phase[] = ['A', 'B', 'C', 'D', 'E'];

export const REGION_SIZE_VP: Readonly<Record<number, number>> = {
  1: 1,
  2: 3,
  3: 6,
  4: 10,
  5: 15,
  6: 21,
  7: 28,
  8: 36,
};

export const PHASE_COMPLETION_VP: Readonly<Record<Phase, number>> = {
  A: 10,
  B: 8,
  C: 6,
  D: 4,
  E: 2,
};

export function regionCompletionScore(size: number, phase: Phase): number {
  const sizeVp = REGION_SIZE_VP[size];
  if (sizeVp === undefined) {
    throw new Error(`Unsupported base-game region size: ${size}`);
  }
  return sizeVp + PHASE_COMPLETION_VP[phase];
}

export function colorCompletionBonus(
  playerCount: PlayerCount,
  placement: 'first' | 'second',
): number {
  if (placement === 'first') return playerCount + 3; // 5 / 6 / 7
  return playerCount; // 2 / 3 / 4
}

export function soldGoodsVpPerTile(playerCount: PlayerCount): number {
  return playerCount;
}

/**
 * One worker moves a die by one step, and the die wraps 1 <-> 6.
 * This returns the minimum workers needed for a requested target.
 */
export function workersNeeded(from: DieValue, to: DieValue): number {
  const direct = Math.abs(from - to);
  const wrap = 6 - direct;
  return Math.min(direct, wrap);
}

export function adjustDie(from: DieValue, delta: 1 | -1): DieValue {
  if (delta === 1) return (from === 6 ? 1 : from + 1) as DieValue;
  return (from === 1 ? 6 : from - 1) as DieValue;
}

export function finalResourceScore(input: {
  unsoldGoods: number;
  silverlings: number;
  workers: number;
  monasteryVp?: number;
}): number {
  return (
    input.unsoldGoods +
    input.silverlings +
    Math.floor(input.workers / 2) +
    (input.monasteryVp ?? 0)
  );
}
