import { WHEEL_TYPES } from './roulette';
import type { TableSettings, WinCondition } from './types';

/** Allowed [min, max] ranges for each setting. */
export const BOUNDS = {
  startingBalance: [10, 1_000_000],
  minBet: [1, 10_000],
  maxBetPerSpot: [1, 1_000_000],
  bettingSeconds: [5, 300],
  spins: [1, 1000],
  target: [2, 100_000_000],
} as const;

type Result = { settings: TableSettings; error?: undefined } | { settings?: undefined; error: string };

function int(v: unknown, [min, max]: readonly [number, number], label: string): number | string {
  const n = Number(v);
  if (!Number.isInteger(n)) return `${label} must be a whole number`;
  if (n < min || n > max) return `${label} must be between ${min.toLocaleString()} and ${max.toLocaleString()}`;
  return n;
}

/** Validates untrusted settings input; used by the server and the client form. */
export function validateSettings(raw: any): Result {
  const startingBalance = int(raw?.startingBalance, BOUNDS.startingBalance, 'Starting chips');
  if (typeof startingBalance === 'string') return { error: startingBalance };
  const minBet = int(raw?.minBet, BOUNDS.minBet, 'Minimum bet');
  if (typeof minBet === 'string') return { error: minBet };
  const maxBetPerSpot = int(raw?.maxBetPerSpot, BOUNDS.maxBetPerSpot, 'Max bet per spot');
  if (typeof maxBetPerSpot === 'string') return { error: maxBetPerSpot };
  const bettingSeconds = int(raw?.bettingSeconds, BOUNDS.bettingSeconds, 'Betting time');
  if (typeof bettingSeconds === 'string') return { error: bettingSeconds };

  if (minBet > startingBalance) return { error: 'Minimum bet cannot exceed starting chips' };
  if (maxBetPerSpot < minBet) return { error: 'Max bet per spot must be at least the minimum bet' };

  let winCondition: WinCondition;
  const wc = raw?.winCondition;
  if (wc?.type === 'mostChips') {
    const spins = int(wc.spins, BOUNDS.spins, 'Number of spins');
    if (typeof spins === 'string') return { error: spins };
    winCondition = { type: 'mostChips', spins };
  } else if (wc?.type === 'target') {
    const amount = int(wc.amount, BOUNDS.target, 'Target chips');
    if (typeof amount === 'string') return { error: amount };
    if (amount <= startingBalance) return { error: 'Target must be higher than starting chips' };
    winCondition = { type: 'target', amount };
  } else if (wc?.type === 'none' || wc === undefined) {
    winCondition = { type: 'none' };
  } else {
    return { error: 'Unknown win condition' };
  }

  const forcedMinBet = raw?.forcedMinBet === true;

  const wheel = raw?.wheel ?? 'double';
  if (!WHEEL_TYPES.some((w) => w.id === wheel)) return { error: 'Unknown table type' };

  return {
    settings: { wheel, startingBalance, minBet, maxBetPerSpot, bettingSeconds, forcedMinBet, winCondition },
  };
}

export function describeWinCondition(wc: WinCondition) {
  if (wc.type === 'mostChips') return `Most chips after ${wc.spins} spin${wc.spins === 1 ? '' : 's'}`;
  if (wc.type === 'target') return `First to ${wc.amount.toLocaleString()} chips`;
  return 'No win condition (free play)';
}
