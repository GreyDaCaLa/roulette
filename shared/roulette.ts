// Shared European (single-zero) roulette rules used by both server and client.

/** Pocket order around a European wheel, clockwise starting at 0. */
export const WHEEL_ORDER = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14,
  31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
] as const;

export const RED_NUMBERS = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

export type PocketColor = 'red' | 'black' | 'green';

export function colorOf(n: number): PocketColor {
  if (n === 0) return 'green';
  return RED_NUMBERS.has(n) ? 'red' : 'black';
}

export type SpotKind =
  | 'straight'
  | 'split'
  | 'street'
  | 'trio'
  | 'corner'
  | 'basket'
  | 'line'
  | 'dozen'
  | 'column'
  | 'red'
  | 'black'
  | 'odd'
  | 'even'
  | 'low'
  | 'high';

/**
 * A place on the table a bet can be placed.
 * `x`/`y` is the anchor point on the betting board in "cell" units:
 * the board is BOARD_W x BOARD_H cells (zero column, 12 number columns, 2-to-1 column;
 * 3 number rows, a dozens row and an even-money row).
 */
export interface Spot {
  id: string;
  kind: SpotKind;
  numbers: number[];
  /** Pays `payout` to 1. */
  payout: number;
  label: string;
  x: number;
  y: number;
}

export const BOARD_W = 14;
export const BOARD_H = 5;

/** Column (0-11) and row (0 = top, 2 = bottom) of a number 1-36 on the layout. */
export function cellOf(n: number) {
  return { c: Math.floor((n - 1) / 3), r: 2 - ((n - 1) % 3) };
}

function buildSpots(): Spot[] {
  const spots: Spot[] = [];
  const add = (
    kind: SpotKind,
    numbers: number[],
    payout: number,
    label: string,
    x: number,
    y: number,
    id?: string,
  ) => {
    const nums = [...numbers].sort((a, b) => a - b);
    spots.push({ id: id ?? `${kind}:${nums.join('-')}`, kind, numbers: nums, payout, label, x, y });
  };
  const range = (from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, i) => from + i);

  // Straight up
  add('straight', [0], 35, '0', 0.5, 1.5);
  for (let n = 1; n <= 36; n++) {
    const { c, r } = cellOf(n);
    add('straight', [n], 35, `${n}`, 1 + c + 0.5, r + 0.5);
  }
  // Splits: side by side (n, n+3)
  for (let n = 1; n <= 33; n++) {
    const { c, r } = cellOf(n);
    add('split', [n, n + 3], 17, `${n}/${n + 3}`, 1 + c + 1, r + 0.5);
  }
  // Splits: stacked (n, n+1)
  for (let n = 1; n <= 36; n++) {
    if (n % 3 === 0) continue;
    const { c, r } = cellOf(n);
    add('split', [n, n + 1], 17, `${n}/${n + 1}`, 1 + c + 0.5, r);
  }
  // Splits with zero
  for (let k = 1; k <= 3; k++) {
    add('split', [0, k], 17, `0/${k}`, 1, cellOf(k).r + 0.5);
  }
  // Streets
  for (let k = 0; k < 12; k++) {
    const a = 3 * k + 1;
    add('street', [a, a + 1, a + 2], 11, `Street ${a}-${a + 2}`, 1 + k + 0.5, 3);
  }
  // Trios with zero
  add('trio', [0, 1, 2], 11, 'Trio 0/1/2', 1, 2);
  add('trio', [0, 2, 3], 11, 'Trio 0/2/3', 1, 1);
  // Corners
  for (let n = 1; n <= 32; n++) {
    if (n % 3 === 0) continue;
    const { c, r } = cellOf(n);
    add('corner', [n, n + 1, n + 3, n + 4], 8, `Corner ${n}/${n + 1}/${n + 3}/${n + 4}`, 1 + c + 1, r);
  }
  // First four
  add('basket', [0, 1, 2, 3], 8, 'First four', 1, 3);
  // Six lines
  for (let k = 0; k < 11; k++) {
    const a = 3 * k + 1;
    add('line', range(a, a + 5), 5, `Line ${a}-${a + 5}`, 1 + k + 1, 3);
  }
  // Dozens
  const dozenNames = ['1st 12', '2nd 12', '3rd 12'];
  for (let d = 1; d <= 3; d++) {
    add('dozen', range(12 * (d - 1) + 1, 12 * d), 2, dozenNames[d - 1], 1 + (d - 1) * 4 + 2, 3.5, `dozen:${d}`);
  }
  // Columns (column 1 = 1,4,7... = bottom row)
  for (let k = 1; k <= 3; k++) {
    const nums = range(1, 36).filter((n) => n % 3 === k % 3);
    add('column', nums, 2, `Column ${k}`, 13.5, 3 - k + 0.5, `column:${k}`);
  }
  // Even-money bets
  const all = range(1, 36);
  add('low', range(1, 18), 1, '1-18', 2, 4.5, 'low');
  add('even', all.filter((n) => n % 2 === 0), 1, 'Even', 4, 4.5, 'even');
  add('red', all.filter((n) => RED_NUMBERS.has(n)), 1, 'Red', 6, 4.5, 'red');
  add('black', all.filter((n) => !RED_NUMBERS.has(n)), 1, 'Black', 8, 4.5, 'black');
  add('odd', all.filter((n) => n % 2 === 1), 1, 'Odd', 10, 4.5, 'odd');
  add('high', range(19, 36), 1, '19-36', 12, 4.5, 'high');

  return spots;
}

export const SPOTS: Spot[] = buildSpots();
export const SPOTS_BY_ID = new Map(SPOTS.map((s) => [s.id, s]));

export function spotWins(spot: Spot, result: number) {
  return spot.numbers.includes(result);
}

/** Total returned to the player (stake + winnings) for a winning bet. */
export function winningReturn(spot: Spot, amount: number) {
  return amount * (spot.payout + 1);
}
