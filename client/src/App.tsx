import { useEffect, useRef, useState } from 'react';
import { colorOf } from '../../shared/roulette';
import type { Ack, Bet, GameState } from '../../shared/types';
import BettingBoard from './components/BettingBoard';
import { History, PhaseBanner, PlayersPanel } from './components/Panels';
import Wheel3D from './components/Wheel3D';
import { api, isDisplayMode, join, useGame } from './game';

const CHIPS = [1, 5, 25, 100, 500];
const CHIP_COLORS: Record<number, string> = {
  1: '#e8e8e8', 5: '#c62828', 25: '#2e7d32', 100: '#212121', 500: '#6a1b9a',
};

export default function App() {
  const { state, playerId, connected, rejoining } = useGame();
  const display = isDisplayMode();

  if (!state) return <div className="center-screen">Connecting to the table…</div>;
  if (!display && !playerId) {
    return rejoining ? <div className="center-screen">Rejoining…</div> : <JoinScreen />;
  }
  return <Table state={state} playerId={display ? null : playerId} connected={connected} display={display} />;
}

function JoinScreen() {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="center-screen">
      <form
        className="join"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          await join(name.trim());
          setBusy(false);
        }}
      >
        <h1>Roulette Night</h1>
        <p className="muted">A European roulette simulator for friends. Play chips only.</p>
        <input
          autoFocus
          maxLength={20}
          placeholder="Your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button disabled={busy || !name.trim()}>Join table</button>
        <a href="?display">Open table display (for a TV or shared screen)</a>
      </form>
    </div>
  );
}

interface TableProps {
  state: GameState;
  playerId: string | null;
  connected: boolean;
  display: boolean;
}

function Table({ state, playerId, connected, display }: TableProps) {
  const [chip, setChip] = useState(5);
  const [toast, setToast] = useState<string | null>(null);
  const undoStack = useRef<{ spot: string; amount: number }[]>([]);
  const previousBets = useRef<Bet[]>([]);
  const toastTimer = useRef<number | undefined>(undefined);

  const me = state.players.find((p) => p.id === playerId) ?? null;
  const myBets = state.bets.filter((b) => b.playerId === playerId);
  const myStake = myBets.reduce((t, b) => t + b.amount, 0);
  const canBet = !!me && state.phase === 'betting';

  useEffect(() => {
    undoStack.current = [];
  }, [state.roundId]);

  // Remember this round's bets once betting closes, for "Rebet".
  useEffect(() => {
    if (state.phase === 'spinning' && playerId) {
      previousBets.current = state.bets.filter((b) => b.playerId === playerId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, state.roundId]);

  const flash = (msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2500);
  };
  const check = (r: Ack) => {
    if (!r.ok) flash(r.error ?? 'Something went wrong');
    return r.ok;
  };

  const place = async (spot: string) => {
    if (!canBet) return;
    if (check(await api.placeBet(spot, chip))) undoStack.current.push({ spot, amount: chip });
  };
  const remove = async (spot: string) => {
    if (!canBet) return;
    check(await api.removeBet(spot));
  };
  const undo = async () => {
    const last = undoStack.current.pop();
    if (last) check(await api.removeBet(last.spot, last.amount));
  };
  const clear = async () => {
    if (check(await api.clearBets())) undoStack.current = [];
  };
  const rebet = async () => {
    for (const b of previousBets.current) {
      if (!check(await api.placeBet(b.spot, b.amount))) break;
      undoStack.current.push({ spot: b.spot, amount: b.amount });
    }
  };

  const result = state.phase === 'results' && state.spin ? state.spin.result : null;

  return (
    <div className={`app ${display ? 'display' : ''}`}>
      <header>
        <h1>Roulette Night</h1>
        <PhaseBanner state={state} />
        <div className="header-right">
          {!connected && <span className="offline-badge">Reconnecting…</span>}
          {me && (
            <div className="my-balance">
              <span className="dot" style={{ background: me.color }} />
              {me.name}: <b>{me.balance.toLocaleString()}</b>
              {myStake > 0 && <span className="muted"> ({myStake} on table)</span>}
            </div>
          )}
        </div>
      </header>

      <main className="top">
        <section className="wheel-panel">
          <Wheel3D spin={state.spin} />
          {result !== null && (
            <div className={`result-badge ${colorOf(result)}`}>
              <span>{result}</span>
            </div>
          )}
        </section>
        <aside className="side">
          <PlayersPanel state={state} playerId={playerId} />
          <History history={state.history} />
        </aside>
      </main>

      <section className="board-panel">
        <BettingBoard
          state={state}
          playerId={playerId}
          interactive={canBet}
          onPlace={place}
          onRemove={remove}
        />
        {me && (
          <div className="controls">
            <div className="chips">
              {CHIPS.map((v) => (
                <button
                  key={v}
                  className={`chip-btn ${chip === v ? 'selected' : ''}`}
                  style={{ background: CHIP_COLORS[v] }}
                  disabled={v > me.balance}
                  onClick={() => setChip(v)}
                >
                  {v}
                </button>
              ))}
            </div>
            <div className="actions">
              <button onClick={undo} disabled={!canBet || myBets.length === 0}>Undo</button>
              <button onClick={clear} disabled={!canBet || myBets.length === 0}>Clear</button>
              <button
                onClick={rebet}
                disabled={!canBet || myBets.length > 0 || previousBets.current.length === 0}
              >
                Rebet
              </button>
              {me.balance < state.limits.minBet && myBets.length === 0 && (
                <button className="primary" onClick={async () => check(await api.rebuy())}>
                  Get {state.limits.startingBalance} more play chips
                </button>
              )}
            </div>
            <p className="hint muted">
              Click to bet · click lines/corners for splits, streets & corners · right-click removes your bet
            </p>
          </div>
        )}
      </section>

      <footer>
        Play money only: this simulator never accepts, holds, or pays out real money.
      </footer>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
