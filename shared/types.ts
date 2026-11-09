// Wire types shared between the server and client.

export type Phase = 'betting' | 'spinning' | 'results' | 'gameover';

export type WinCondition =
  | { type: 'none' }
  /** After `spins` spins, whoever holds the most chips wins. */
  | { type: 'mostChips'; spins: number }
  /** First player to reach `amount` chips wins. */
  | { type: 'target'; amount: number };

export interface TableSettings {
  startingBalance: number;
  minBet: number;
  maxBetPerSpot: number;
  bettingSeconds: number;
  /** Players with no bets when betting closes automatically bet the minimum on black. */
  forcedMinBet: boolean;
  winCondition: WinCondition;
}

export interface MatchState {
  spinsPlayed: number;
  over: boolean;
  winners: string[];
}

export interface PublicPlayer {
  id: string;
  name: string;
  color: string;
  /** Chips available (bets on the table are already deducted). */
  balance: number;
  connected: boolean;
}

export interface Bet {
  playerId: string;
  spot: string;
  amount: number;
  /** Placed automatically by the forced-minimum-bet rule. */
  forced?: boolean;
}

export interface SpinInfo {
  roundId: number;
  /** Server timestamp (ms) when the ball was launched. */
  startedAt: number;
  duration: number;
  result: number;
}

export interface PlayerRoundResult {
  playerId: string;
  staked: number;
  returned: number;
  net: number;
}

export interface RoundResult {
  roundId: number;
  number: number;
  players: PlayerRoundResult[];
}

export interface GameState {
  roundId: number;
  phase: Phase;
  /** Server timestamp when the current phase ends; null while waiting for the first bet. */
  phaseEndsAt: number | null;
  serverNow: number;
  players: PublicPlayer[];
  bets: Bet[];
  spin: SpinInfo | null;
  lastRound: RoundResult | null;
  /** Most recent results first. */
  history: number[];
  /** Player who can change table settings. */
  hostId: string | null;
  /** Players who have locked in their bets this round. */
  lockedIds: string[];
  settings: TableSettings;
  match: MatchState;
}

export interface Ack {
  ok: boolean;
  error?: string;
}

export interface JoinAck extends Ack {
  playerId?: string;
  token?: string;
}
