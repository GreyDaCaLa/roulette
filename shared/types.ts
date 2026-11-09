// Wire types shared between the server and client.

export type Phase = 'betting' | 'spinning' | 'results';

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
  limits: { minBet: number; maxBetPerSpot: number; startingBalance: number };
}

export interface Ack {
  ok: boolean;
  error?: string;
}

export interface JoinAck extends Ack {
  playerId?: string;
  token?: string;
}
