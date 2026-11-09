import express from 'express';
import { createServer } from 'node:http';
import { randomInt, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import { SPOTS_BY_ID, spotWins, winningReturn } from '../../shared/roulette';
import type {
  Ack,
  Bet,
  GameState,
  JoinAck,
  Phase,
  PlayerRoundResult,
  PublicPlayer,
  RoundResult,
  SpinInfo,
} from '../../shared/types';

// ---------------------------------------------------------------------------
// Config (override with environment variables)
// ---------------------------------------------------------------------------
function envNum(key: string, fallback: number) {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}
const PORT = envNum('PORT', 3001);
const BETTING_MS = envNum('BETTING_SECONDS', 20) * 1000;
const SPIN_MS = envNum('SPIN_SECONDS', 9) * 1000;
const RESULTS_MS = envNum('RESULTS_SECONDS', 6) * 1000;
const STARTING_BALANCE = envNum('STARTING_BALANCE', 1000);
const MAX_BET_PER_SPOT = envNum('MAX_BET_PER_SPOT', 500);
const MIN_BET = 1;
const HISTORY_LENGTH = 20;

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
  private phase: Phase = 'betting';
  private phaseEndsAt: number | null = null;
  private roundId = 1;
  private spin: SpinInfo | null = null;
  private lastRound: RoundResult | null = null;
  private history: number[] = [];
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
      limits: { minBet: MIN_BET, maxBetPerSpot: MAX_BET_PER_SPOT, startingBalance: STARTING_BALANCE },
    };
  }

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
        balance: STARTING_BALANCE,
        connected: true,
        sockets: new Set(),
      };
      this.players.set(player.id, player);
      this.byToken.set(player.token, player);
    }
    player.name = name;
    player.sockets.add(socketId);
    player.connected = true;
    this.onChange();
    return { player };
  }

  leave(player: Player, socketId: string) {
    player.sockets.delete(socketId);
    player.connected = player.sockets.size > 0;
    this.onChange();
  }

  placeBet(player: Player, spotId: unknown, rawAmount: unknown): string | null {
    if (this.phase !== 'betting') return 'Bets are closed';
    const spot = typeof spotId === 'string' ? SPOTS_BY_ID.get(spotId) : undefined;
    if (!spot) return 'Unknown bet';
    const amount = Number(rawAmount);
    if (!Number.isInteger(amount) || amount < MIN_BET) return `Minimum bet is ${MIN_BET}`;
    if (amount > player.balance) return 'Not enough chips';

    const key = `${player.id}|${spot.id}`;
    const existing = this.bets.get(key);
    const total = (existing?.amount ?? 0) + amount;
    if (total > MAX_BET_PER_SPOT) return `Max ${MAX_BET_PER_SPOT} per spot`;

    player.balance -= amount;
    this.bets.set(key, { playerId: player.id, spot: spot.id, amount: total });

    // Countdown starts with the first bet of the round.
    if (this.phaseEndsAt === null) this.schedule(BETTING_MS, () => this.startSpin());
    this.onChange();
    return null;
  }

  /** Remove `amount` from a bet (or the whole bet if amount is omitted). */
  removeBet(player: Player, spotId: unknown, rawAmount?: unknown): string | null {
    if (this.phase !== 'betting') return 'Bets are closed';
    const key = `${player.id}|${String(spotId)}`;
    const bet = this.bets.get(key);
    if (!bet) return 'No bet there';
    const amount = rawAmount === undefined ? bet.amount : Math.min(bet.amount, Number(rawAmount));
    if (!Number.isInteger(amount) || amount <= 0) return 'Invalid amount';

    bet.amount -= amount;
    player.balance += amount;
    if (bet.amount === 0) this.bets.delete(key);
    this.onChange();
    return null;
  }

  clearBets(player: Player): string | null {
    if (this.phase !== 'betting') return 'Bets are closed';
    for (const [key, bet] of this.bets) {
      if (bet.playerId === player.id) {
        player.balance += bet.amount;
        this.bets.delete(key);
      }
    }
    this.onChange();
    return null;
  }

  /** Free play-money top-up when a player has run out. */
  rebuy(player: Player): string | null {
    const hasBets = [...this.bets.values()].some((b) => b.playerId === player.id);
    if (player.balance >= MIN_BET || hasBets) return 'You still have chips';
    player.balance = STARTING_BALANCE;
    this.onChange();
    return null;
  }

  private schedule(ms: number, fn: () => void) {
    if (this.timer) clearTimeout(this.timer);
    this.phaseEndsAt = Date.now() + ms;
    this.timer = setTimeout(fn, ms);
  }

  private startSpin() {
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
    this.phase = 'results';
    this.schedule(RESULTS_MS, () => this.newRound());
    this.onChange();
  }

  private newRound() {
    this.bets.clear();
    this.roundId += 1;
    this.phase = 'betting';
    this.phaseEndsAt = null;
    this.timer = null;
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
  socket.on('rebuy', withPlayer((p) => game.rebuy(p)));

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
