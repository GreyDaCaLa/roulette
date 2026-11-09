# Roulette Night

A multiplayer European roulette **simulator** built with React, React Three Fiber and Socket.IO.
It uses play chips only: it never accepts, holds or pays out real money.

## Structure

```
shared/   Roulette rules: wheel order, colors, every bet spot and its payout (used by both sides)
server/   Express + Socket.IO game server. Runs the rounds, checks bets, spins, settles chips
client/   Vite + React + R3F. 3D wheel, betting layout with everyone's chips, players panel
```

The server is the only source of truth. Clients send bet requests, and the server checks them
against the phase, balance and limits. The server draws each result with `crypto.randomInt`.
Every client animates the ball from the server's spin timestamp, so all screens show the same spin.

## Running

```bash
npm install
npm run dev        # server on :3001 + Vite on :5173 (exposed on your LAN)
```

Players open `http://<host-ip>:5173`. Open `http://<host-ip>:5173/?display` on a TV or shared
screen for a view-only table.

Production (one port):

```bash
npm run build
npm start          # serves the built client and the game on :3001
```

## Round flow

1. **Betting**: the countdown starts when the first bet is placed (`BETTING_SECONDS`, default 20).
2. **Spinning**: no more bets; the ball spins (`SPIN_SECONDS`, default 9).
3. **Results**: payouts are applied and shown (`RESULTS_SECONDS`, default 6), then a new round starts.

Other env vars: `PORT` (3001), `STARTING_BALANCE` (1000), `MAX_BET_PER_SPOT` (500).

Players who refresh keep their seat and chips (a token is stored in localStorage). State lives
in memory and resets when the server restarts.
