// Shared roulette rules used by both server and client.
// Supports single-zero (European), double-zero (American) and triple-zero tables.

export type WheelType = 'single' | 'double' | 'triple';

export const WHEEL_TYPES: { id: WheelType; label: string }[] = [
  { id: 'single', label: '0 - European (37 pockets)' },
  { id: 'double', label: '00 - American (38 pockets)' },
  { id: 'triple', label: '000 - Triple zero (39 pockets)' },
];

/** Internal numbers for the extra zeros. */
export const DOUBLE_ZERO = 37;
export const TRIPLE_ZERO = 38;

/** Display label for a pocket number: 37 → "00", 38 → "000". */
export function labelOf(n: number) {
  if (n === DOUBLE_ZERO) return '00';
  if (n === TRIPLE_ZERO) return '000';
  return String(n);
}

export function isZero(n: number) {
  return n === 0 || n === DOUBLE_ZERO || n === TRIPLE_ZERO;
}

const AMERICAN_ORDER = [
  0, 28, 9, 26, 30, 11, 7, 20, 32, 17, 5, 22, 34, 15, 3, 24, 36, 13, 1,
  DOUBLE_ZERO, 27, 10, 25, 29, 12, 8, 19, 31, 18, 6, 21, 33, 16, 4, 23, 35, 14, 2,
];

/** Pocket order around each wheel, clockwise starting at 0. */
export const WHEEL_ORDERS: Record<WheelType, readonly number[]> = {
  single: [
    0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14,
    31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
  ],
  double: AMERICAN_ORDER,
  // American sequence with 000 placed beside 00.
  triple: [...AMERICAN_ORDER.slice(0, 20), TRIPLE_ZERO, ...AMERICAN_ORDER.slice(20)],
};

export function pocketCount(wheel: WheelType) {
  return WHEEL_ORDERS[wheel].length;
}

export const RED_NUMBERS = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

export type PocketColor = 'red' | 'black' | 'green';

export function colorOf(n: number): PocketColor {
  if (isZero(n)) return 'green';
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
  /** Height in cells of a zero's cell (the zero column is shared between the zeros). */
  cellH?: number;
}

export const BOARD_W = 14;
export const BOARD_H = 5;

/** Column (0-11) and row (0 = top, 2 = bottom) of a number 1-36 on the layout. */
export function cellOf(n: number) {
  return { c: Math.floor((n - 1) / 3), r: 2 - ((n - 1) % 3) };
}

function buildSpots(wheel: WheelType): Spot[] {
  const spots: Spot[] = [];
  const add = (
    kind: SpotKind,
    numbers: number[],
    payout: number,
    label: string,
    x: number,
    y: number,
    extra?: { id?: string; cellH?: number },
  ) => {
    const nums = [...numbers].sort((a, b) => a - b);
    spots.push({
      id: extra?.id ?? `${kind}:${nums.join('-')}`,
      kind, numbers: nums, payout, label, x, y,
      ...(extra?.cellH ? { cellH: extra.cellH } : {}),
    });
  };
  const range = (from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const Z0 = 0;
  const Z00 = DOUBLE_ZERO;
  const Z000 = TRIPLE_ZERO;

  // ----- Zero column (differs per wheel) -----
  if (wheel === 'single') {
    add('straight', [Z0], 35, '0', 0.5, 1.5, { cellH: 3 });
    for (let k = 1; k <= 3; k++) add('split', [Z0, k], 17, `0/${k}`, 1, cellOf(k).r + 0.5);
    add('trio', [Z0, 1, 2], 11, 'Trio 0/1/2', 1, 2);
    add('trio', [Z0, 2, 3], 11, 'Trio 0/2/3', 1, 1);
    add('basket', [Z0, 1, 2, 3], 8, 'First four', 1, 3);
  } else if (wheel === 'double') {
    // 00 on top (beside 3), 0 below (beside 1).
    add('straight', [Z00], 35, '00', 0.5, 0.75, { cellH: 1.5 });
    add('straight', [Z0], 35, '0', 0.5, 2.25, { cellH: 1.5 });
    add('split', [Z0, Z00], 17, '0/00', 0.5, 1.5);
    add('split', [Z00, 3], 17, '00/3', 1, 0.5);
    add('split', [Z0, 1], 17, '0/1', 1, 2.5);
    add('trio', [Z00, 2, 3], 11, 'Trio 00/2/3', 1, 1);
    add('trio', [Z0, Z00, 2], 11, 'Trio 0/00/2', 1, 1.5);
    add('trio', [Z0, 1, 2], 11, 'Trio 0/1/2', 1, 2);
    add('basket', [Z0, Z00, 1, 2, 3], 6, 'Top line 0/00/1/2/3', 1, 3);
  } else {
    // 000 on top (beside 3), 00 in the middle (beside 2), 0 at the bottom (beside 1).
    add('straight', [Z000], 35, '000', 0.5, 0.5, { cellH: 1 });
    add('straight', [Z00], 35, '00', 0.5, 1.5, { cellH: 1 });
    add('straight', [Z0], 35, '0', 0.5, 2.5, { cellH: 1 });
    add('split', [Z000, 3], 17, '000/3', 1, 0.5);
    add('split', [Z00, 2], 17, '00/2', 1, 1.5);
    add('split', [Z0, 1], 17, '0/1', 1, 2.5);
    add('split', [Z000, Z00], 17, '000/00', 0.5, 1);
    add('split', [Z00, Z0], 17, '00/0', 0.5, 2);
    add('corner', [Z000, Z00, 2, 3], 8, 'Corner 000/00/2/3', 1, 1);
    add('corner', [Z00, Z0, 1, 2], 8, 'Corner 00/0/1/2', 1, 2);
    add('trio', [Z0, Z00, Z000], 11, 'Trio 0/00/000', 0.5, 3);
    add('basket', [Z0, Z00, Z000, 1, 2, 3], 5, 'Top line 0/00/000/1/2/3', 1, 3);
  }

  // ----- Numbers 1-36 (same on every table) -----
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
  // Streets
  for (let k = 0; k < 12; k++) {
    const a = 3 * k + 1;
    add('street', [a, a + 1, a + 2], 11, `Street ${a}-${a + 2}`, 1 + k + 0.5, 3);
  }
  // Corners
  for (let n = 1; n <= 32; n++) {
    if (n % 3 === 0) continue;
    const { c, r } = cellOf(n);
    add('corner', [n, n + 1, n + 3, n + 4], 8, `Corner ${n}/${n + 1}/${n + 3}/${n + 4}`, 1 + c + 1, r);
  }
  // Six lines
  for (let k = 0; k < 11; k++) {
    const a = 3 * k + 1;
    add('line', range(a, a + 5), 5, `Line ${a}-${a + 5}`, 1 + k + 1, 3);
  }
  // Dozens
  const dozenNames = ['1st 12', '2nd 12', '3rd 12'];
  for (let d = 1; d <= 3; d++) {
    add('dozen', range(12 * (d - 1) + 1, 12 * d), 2, dozenNames[d - 1], 1 + (d - 1) * 4 + 2, 3.5, { id: `dozen:${d}` });
  }
  // Columns (column 1 = 1,4,7... = bottom row)
  for (let k = 1; k <= 3; k++) {
    const nums = range(1, 36).filter((n) => n % 3 === k % 3);
    add('column', nums, 2, `Column ${k}`, 13.5, 3 - k + 0.5, { id: `column:${k}` });
  }
  // Even-money bets (all zeros lose)
  const all = range(1, 36);
  add('low', range(1, 18), 1, '1-18', 2, 4.5, { id: 'low' });
  add('even', all.filter((n) => n % 2 === 0), 1, 'Even', 4, 4.5, { id: 'even' });
  add('red', all.filter((n) => RED_NUMBERS.has(n)), 1, 'Red', 6, 4.5, { id: 'red' });
  add('black', all.filter((n) => !RED_NUMBERS.has(n)), 1, 'Black', 8, 4.5, { id: 'black' });
  add('odd', all.filter((n) => n % 2 === 1), 1, 'Odd', 10, 4.5, { id: 'odd' });
  add('high', range(19, 36), 1, '19-36', 12, 4.5, { id: 'high' });

  return spots;
}

const spotCache = new Map<WheelType, { list: Spot[]; byId: Map<string, Spot> }>();

/** All bet spots for a table type (cached). */
export function getSpots(wheel: WheelType) {
  let entry = spotCache.get(wheel);
  if (!entry) {
    const list = buildSpots(wheel);
    entry = { list, byId: new Map(list.map((s) => [s.id, s])) };
    spotCache.set(wheel, entry);
  }
  return entry;
}

export function spotWins(spot: Spot, result: number) {
  return spot.numbers.includes(result);
}

/** Total returned to the player (stake + winnings) for a winning bet. */
export function winningReturn(spot: Spot, amount: number) {
  return amount * (spot.payout + 1);
}
