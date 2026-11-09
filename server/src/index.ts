import express from 'express';
import { createServer } from 'node:http';
import { randomInt, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { SPOTS_BY_ID, spotWins, winningReturn } from '../../shared/roulette';
import { validateSettings } from '../../shared/settings';
import type {
  Ack,
  Bet,
  GameState,
  JoinAck,
  MatchState,
  Phase,
  PlayerRoundResult,
  PublicPlayer,
  RoundResult,
  SpinInfo,
  TableSettings,
} from '../../shared/types';

// ---------------------------------------------------------------------------
// Config (environment variables set the defaults; the host can change them in game)
// ---------------------------------------------------------------------------
function envNum(key: string, fallback: number) {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}
const PORT = envNum('PORT', 3001);
const SPIN_MS = envNum('SPIN_SECONDS', 9) * 1000;
const RESULTS_MS = envNum('RESULTS_SECONDS', 6) * 1000;
const HISTORY_LENGTH = 20;

const DEFAULT_SETTINGS: TableSettings = {
  startingBalance: envNum('STARTING_BALANCE', 1000),
  minBet: 1,
  maxBetPerSpot: envNum('MAX_BET_PER_SPOT', 500),
  bettingSeconds: envNum('BETTING_SECONDS', 20),
  forcedMinBet: process.env.FORCED_MIN_BET === 'true',
  winCondition: { type: 'none' },
};

const PLAYER_COLORS = [
  '#f6c945', '#4dd0e1', '#ba68c8', '#ff8a65', '#aed581', '#f06292',
  '#7986cb', '#4db6ac', '#fff176', '#90caf9', '#ffb74d', '#e0e0e0',
];

// ---------------------------------------------------------------------------
// Game
// ---------------------------------------------------------------------------
interface Player extends PublicPlayer {
  token: string;
  sockets: Set<string>;
}

class Game {
  private players = new Map<string, Player>();
  private byToken = new Map<string, Player>();
  /** key: `${playerId}|${spotId}` */
  private bets = new Map<string, Bet>();
  private locked = new Set<string>();
  private phase: Phase = 'betting';
  private phaseEndsAt: number | null = null;
  private roundId = 1;
  private spin: SpinInfo | null = null;
  private lastRound: RoundResult | null = null;
  private history: number[] = [];
  private hostId: string | null = null;
  private settings: TableSettings = DEFAULT_SETTINGS;
  private match: MatchState = { spinsPlayed: 0, over: false, winners: [] };
  private timer: NodeJS.Timeout | null = null;

  constructor(private onChange: () => void) {}

  snapshot(): GameState {
    return {
      roundId: this.roundId,
      phase: this.phase,
      phaseEndsAt: this.phaseEndsAt,
      serverNow: Date.now(),
      players: [...this.players.values()].map(({ id, name, color, balance, connected }) => ({
        id, name, color, balance, connected,
      })),
      bets: [...this.bets.values()],
      spin: this.spin,
      lastRound: this.lastRound,
      history: this.history,
      hostId: this.hostId,
      lockedIds: [...this.locked],
      settings: this.settings,
      match: this.match,
    };
  }

  // ----- Players ------------------------------------------------------------

  join(socketId: string, token: unknown, rawName: unknown): { player: Player } {
    const name =
      (typeof rawName === 'string' ? rawName.replace(/\s+/g, ' ').trim().slice(0, 20) : '') ||
      `Player ${this.players.size + 1}`;

    let player = typeof token === 'string' ? this.byToken.get(token) : undefined;
    if (!player) {
      player = {
        id: randomUUID(),
        token: randomUUID(),
        name,
        color: PLAYER_COLORS[this.players.size % PLAYER_COLORS.length],
        balance: this.settings.startingBalance,
        connected: true,
        sockets: new Set(),
      };
      this.players.set(player.id, player);
      this.byToken.set(player.token, player);
    }
    player.name = name;
    player.sockets.add(socketId);
    player.connected = true;

    const host = this.hostId ? this.players.get(this.hostId) : undefined;
    if (!host || !host.connected) this.hostId = player.id;

    this.onChange();
    return { player };
  }

  leave(player: Player, socketId: string) {
    player.sockets.delete(socketId);
    player.connected = player.sockets.size > 0;
    if (!player.connected && this.hostId === player.id) {
      // Hand hosting to the longest-seated connected player (if any).
      const next = [...this.players.values()].find((p) => p.connected);
      if (next) this.hostId = next.id;
    }
    this.onChange();
    this.checkAllLocked();
  }

  // ----- Betting ------------------------------------------------------------

  private canChangeBets(player: Player): string | null {
    if (this.phase !== 'betting') return this.phase === 'gameover' ? 'The game is over' : 'Bets are closed';
    if (this.locked.has(player.id)) return 'You are locked in - unlock to change bets';
    return null;
  }

  placeBet(player: Player, spotId: unknown, rawAmount: unknown): string | null {
    const blocked = this.canChangeBets(player);
    if (blocked) return blocked;
    const spot = typeof spotId === 'string' ? SPOTS_BY_ID.get(spotId) : undefined;
    if (!spot) return 'Unknown bet';
    const amount = Number(rawAmount);
    const { minBet, maxBetPerSpot, bettingSeconds } = this.settings;
    if (!Number.isInteger(amount) || amount <= 0) return 'Invalid amount';
    if (amount > player.balance) return 'Not enough chips';

    const key = `${player.id}|${spot.id}`;
    const existing = this.bets.get(key);
    const total = (existing?.amount ?? 0) + amount;
    if (total < minBet) return `Minimum bet is ${minBet}`;
    if (total > maxBetPerSpot) return `Max ${maxBetPerSpot} per spot`;

    player.balance -= amount;
    this.bets.set(key, { playerId: player.id, spot: spot.id, amount: total });

    // Countdown starts with the first bet of the round.
    if (this.phaseEndsAt === null) this.schedule(bettingSeconds * 1000, () => this.startSpin());
    this.onChange();
    return null;
  }

  /** Remove `amount` from a bet (or the whole bet if amount is omitted). */
  removeBet(player: Player, spotId: unknown, rawAmount?: unknown): string | null {
    const blocked = this.canChangeBets(player);
    if (blocked) return blocked;
    const key = `${player.id}|${String(spotId)}`;
    const bet = this.bets.get(key);
    if (!bet) return 'No bet there';
    let amount = rawAmount === undefined ? bet.amount : Math.min(bet.amount, Number(rawAmount));
    if (!Number.isInteger(amount) || amount <= 0) return 'Invalid amount';
    // Never leave a bet below the table minimum: remove it entirely instead.
    if (bet.amount - amount > 0 && bet.amount - amount < this.settings.minBet) amount = bet.amount;

    bet.amount -= amount;
    player.balance += amount;
    if (bet.amount === 0) this.bets.delete(key);
    this.onChange();
    return null;
  }

  clearBets(player: Player): string | null {
    const blocked = this.canChangeBets(player);
    if (blocked) return blocked;
    for (const [key, bet] of this.bets) {
      if (bet.playerId === player.id) {
        player.balance += bet.amount;
        this.bets.delete(key);
      }
    }
    this.onChange();
    return null;
  }

  /** Lock in (or unlock) your bets. When every connected player is locked in, the ball spins. */
  setLocked(player: Player, locked: boolean): string | null {
    if (this.phase !== 'betting') return 'Bets are closed';
    if (locked) this.locked.add(player.id);
    else this.locked.delete(player.id);
    this.onChange();
    this.checkAllLocked();
    return null;
  }

  private checkAllLocked() {
    if (this.phase !== 'betting' || this.bets.size === 0) return;
    const connected = [...this.players.values()].filter((p) => p.connected);
    if (connected.length > 0 && connected.every((p) => this.locked.has(p.id))) this.startSpin();
  }

  /** Free play-money top-up when a player has run out (free play only). */
  rebuy(player: Player): string | null {
    if (this.settings.winCondition.type !== 'none') return 'Rebuys are only allowed in free play';
    const hasBets = [...this.bets.values()].some((b) => b.playerId === player.id);
    if (player.balance >= this.settings.minBet || hasBets) return 'You still have chips';
    player.balance = this.settings.startingBalance;
    this.onChange();
    return null;
  }

  // ----- Host controls ------------------------------------------------------

  updateSettings(player: Player, raw: unknown): string | null {
    if (player.id !== this.hostId) return 'Only the host can change table settings';
    if (this.phase === 'spinning' || this.phase === 'results') return 'Wait for the spin to finish';
    const { settings, error } = validateSettings(raw);
    if (!settings) return error;
    this.settings = settings;
    this.startNewGame();
    return null;
  }

  newGame(player: Player): string | null {
    if (player.id !== this.hostId) return 'Only the host can start a new game';
    if (this.phase === 'spinning' || this.phase === 'results') return 'Wait for the spin to finish';
    this.startNewGame();
    return null;
  }

  /** Resets everyone's chips to the starting amount and starts a fresh match. */
  private startNewGame() {
    for (const p of this.players.values()) p.balance = this.settings.startingBalance;
    this.match = { spinsPlayed: 0, over: false, winners: [] };
    this.lastRound = null;
    this.newRound();
  }

  // ----- Round loop -----------------------------------------------------------

  private schedule(ms: number, fn: () => void) {
    this.clearTimer();
    this.phaseEndsAt = Date.now() + ms;
    this.timer = setTimeout(fn, ms);
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Forced-minimum-bet rule: anyone seated without a bet puts the minimum on black. */
  private placeForcedBets() {
    if (!this.settings.forcedMinBet) return;
    const { minBet } = this.settings;
    const hasBet = new Set([...this.bets.values()].map((b) => b.playerId));
    for (const p of this.players.values()) {
      if (!p.connected || hasBet.has(p.id) || p.balance < minBet) continue;
      p.balance -= minBet;
      this.bets.set(`${p.id}|black`, { playerId: p.id, spot: 'black', amount: minBet, forced: true });
    }
  }

  private startSpin() {
    this.placeForcedBets();
    this.phase = 'spinning';
    this.spin = {
      roundId: this.roundId,
      startedAt: Date.now(),
      duration: SPIN_MS,
      result: randomInt(0, 37), // cryptographically secure, uniform 0..36
    };
    this.schedule(SPIN_MS, () => this.settle());
    this.onChange();
  }

  private settle() {
    const result = this.spin!.result;
    const perPlayer = new Map<string, PlayerRoundResult>();

    for (const bet of this.bets.values()) {
      const spot = SPOTS_BY_ID.get(bet.spot)!;
      const entry = perPlayer.get(bet.playerId) ?? {
        playerId: bet.playerId, staked: 0, returned: 0, net: 0,
      };
      entry.staked += bet.amount;
      if (spotWins(spot, result)) entry.returned += winningReturn(spot, bet.amount);
      perPlayer.set(bet.playerId, entry);
    }
    for (const entry of perPlayer.values()) {
      entry.net = entry.returned - entry.staked;
      const player = this.players.get(entry.playerId);
      if (player) player.balance += entry.returned;
    }

    this.lastRound = { roundId: this.roundId, number: result, players: [...perPlayer.values()] };
    this.history = [result, ...this.history].slice(0, HISTORY_LENGTH);
    this.checkWinCondition();
    this.phase = 'results';
    this.schedule(RESULTS_MS, () => (this.match.over ? this.endGame() : this.newRound()));
    this.onChange();
  }

  private checkWinCondition() {
    this.match.spinsPlayed += 1;
    const wc = this.settings.winCondition;
    const ranked = [...this.players.values()].sort((a, b) => b.balance - a.balance);
    let winners: Player[] = [];

    if (wc.type === 'mostChips' && this.match.spinsPlayed >= wc.spins && ranked.length > 0) {
      winners = ranked.filter((p) => p.balance === ranked[0].balance);
    } else if (wc.type === 'target') {
      const reached = ranked.filter((p) => p.balance >= wc.amount);
      // If several players cross the line on the same spin, the highest stack wins (ties share).
      if (reached.length > 0) winners = reached.filter((p) => p.balance === reached[0].balance);
    }
    if (winners.length > 0) this.match = { ...this.match, over: true, winners: winners.map((p) => p.id) };
  }

  private endGame() {
    this.clearTimer();
    this.bets.clear();
    this.locked.clear();
    this.phase = 'gameover';
    this.phaseEndsAt = null;
    this.onChange();
  }

  private newRound() {
    this.clearTimer();
    this.bets.clear();
    this.locked.clear();
    this.roundId += 1;
    this.phase = 'betting';
    this.phaseEndsAt = null;
    this.onChange();
  }
}

// ---------------------------------------------------------------------------
// HTTP + Socket.IO
// ---------------------------------------------------------------------------
const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

const game = new Game(() => io.emit('state', game.snapshot()));

const reply = (ack: unknown, error: string | null) => {
  if (typeof ack === 'function') (ack as (a: Ack) => void)(error ? { ok: false, error } : { ok: true });
};

io.on('connection', (socket) => {
  let player: Player | null = null;
  socket.emit('state', game.snapshot());

  socket.on('join', (data: { token?: string; name?: string } | undefined, ack: unknown) => {
    if (player) game.leave(player, socket.id);
    player = game.join(socket.id, data?.token, data?.name).player;
    if (typeof ack === 'function') {
      (ack as (a: JoinAck) => void)({ ok: true, playerId: player.id, token: player.token });
    }
  });

  const withPlayer =
    (fn: (p: Player, data: any) => string | null) => (data: any, ack: unknown) => {
      if (typeof data === 'function') [data, ack] = [undefined, data];
      reply(ack, player ? fn(player, data ?? {}) : 'Join the table first');
    };

  socket.on('bet:place', withPlayer((p, d) => game.placeBet(p, d.spot, d.amount)));
  socket.on('bet:remove', withPlayer((p, d) => game.removeBet(p, d.spot, d.amount)));
  socket.on('bet:clear', withPlayer((p) => game.clearBets(p)));
  socket.on('lock', withPlayer((p, d) => game.setLocked(p, d.locked !== false)));
  socket.on('rebuy', withPlayer((p) => game.rebuy(p)));
  socket.on('settings:update', withPlayer((p, d) => game.updateSettings(p, d)));
  socket.on('game:new', withPlayer((p) => game.newGame(p)));

  socket.on('disconnect', () => {
    if (player) game.leave(player, socket.id);
  });
});

// Serve the built client in production (npm run build && npm start).
const clientDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/socket.io')) {
      res.sendFile(path.join(clientDist, 'index.html'));
    } else next();
  });
}

httpServer.listen(PORT, () => {
  const lan = Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i!.address);
  console.log(`Roulette server listening on http://localhost:${PORT}`);
  for (const ip of lan) console.log(`  LAN: http://${ip}:${PORT}`);
  if (!existsSync(clientDist)) {
    console.log('  (client not built - in dev, players open the Vite URL, port 5173)');
  }
});
