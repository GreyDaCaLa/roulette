import { useEffect, useRef, useState } from 'react';
import { colorOf, labelOf } from '../../shared/roulette';
import type { Ack, Bet, GameState } from '../../shared/types';
import BettingBoard, { formatChips } from './components/BettingBoard';
import {
  GameOver,
  History,
  JoinQR,
  LastNumbers,
  MatchStatus,
  PhaseBanner,
  PlayersPanel,
} from './components/Panels';
import SettingsModal from './components/SettingsModal';
import Wheel3D from './components/Wheel3D';
import { api, isDisplayMode, join, useGame } from './game';

const CHIPS = [1, 5, 10, 25, 50, 100, 500];
const CHIP_COLORS: Record<number, string> = {
  1: '#e8e8e8', 5: '#c62828', 10: '#1565c0', 25: '#2e7d32', 50: '#ef6c00', 100: '#212121', 500: '#6a1b9a',
};

// Unit chip: a player-defined amount, remembered on this device.
const UNIT_KEY = 'roulette.unitValue';
const MAX_UNIT = 1_000_000;
function loadUnitValue() {
  try {
    const n = Number(localStorage.getItem(UNIT_KEY));
    if (Number.isInteger(n) && n >= 1 && n <= MAX_UNIT) return n;
  } catch {
    /* storage unavailable */
  }
  return 10;
}
function saveUnitValue(n: number) {
  try {
    localStorage.setItem(UNIT_KEY, String(n));
  } catch {
    /* storage unavailable */
  }
}

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
  const [chip, setChip] = useState<number | 'unit'>(5);
  const [unitValue, setUnitValue] = useState(loadUnitValue);
  const [unitDraft, setUnitDraft] = useState(String(unitValue));
  const betAmount = chip === 'unit' ? unitValue : chip;
  const [toast, setToast] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const undoStack = useRef<{ spot: string; amount: number }[]>([]);
  const previousBets = useRef<Bet[]>([]);
  const toastTimer = useRef<number | undefined>(undefined);

  const me = state.players.find((p) => p.id === playerId) ?? null;
  const myBets = state.bets.filter((b) => b.playerId === playerId);
  const myStake = myBets.reduce((t, b) => t + b.amount, 0);
  const isHost = !!me && state.hostId === me.id;
  const isLocked = !!me && state.lockedIds.includes(me.id);
  const canBet = !!me && state.phase === 'betting' && !isLocked;
  const canEditSettings = isHost && (state.phase === 'betting' || state.phase === 'gameover');

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
    const amount = betAmount;
    if (check(await api.placeBet(spot, amount))) undoStack.current.push({ spot, amount });
  };
  const updateUnitDraft = (text: string) => {
    setUnitDraft(text);
    const n = Number(text);
    if (Number.isInteger(n) && n >= 1 && n <= MAX_UNIT) {
      setUnitValue(n);
      saveUnitValue(n);
    }
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

  const wheelPanel = (
    <section className="wheel-panel">
      <Wheel3D spin={state.spin} wheel={state.settings.wheel} />
      {result !== null && (
        <div className={`result-badge ${colorOf(result)}`}>
          <span>{labelOf(result)}</span>
        </div>
      )}
    </section>
  );
  const header = (
      <header>
        <h1>Roulette Night</h1>
        <PhaseBanner state={state} />
        <div className="header-right">
          {!connected && <span className="offline-badge">Reconnecting…</span>}
          {isHost && (
            <button
              onClick={() => setShowSettings(true)}
              disabled={!canEditSettings}
              title={canEditSettings ? 'Change table settings' : 'Wait for the spin to finish'}
            >
              ⚙ Table settings
            </button>
          )}
          {me && (
            <div className="my-balance">
              <span className="dot" style={{ background: me.color }} />
              {me.name}: <b>{me.balance.toLocaleString()}</b>
              {myStake > 0 && <span className="muted"> ({myStake} on table)</span>}
            </div>
          )}
        </div>
      </header>
  );

  return (
    <div className={`app ${display ? 'display' : ''}`}>
      {display ? (
        <>
          {/* Display (TV) view: header + wheel row fill exactly one screen; the info row sits below. */}
          <div className="display-screen">
            {header}
            <main className="display-main">
              <LastNumbers history={state.history} />
              {wheelPanel}
              <section className="board-side">
                <BettingBoard
                  state={state}
                  playerId={playerId}
                  interactive={false}
                  onPlace={place}
                  onRemove={remove}
                  rotated
                />
              </section>
            </main>
          </div>
          <section className="display-bottom">
            <JoinQR />
            <PlayersPanel state={state} playerId={playerId} />
            <MatchStatus state={state} />
          </section>
        </>
      ) : (
        <>
          {header}
          <main className="top">
            {wheelPanel}
            <aside className="side">
              <MatchStatus state={state} />
              <PlayersPanel state={state} playerId={playerId} />
              <History history={state.history} />
            </aside>
          </main>
        </>
      )}

      <section className="board-panel" hidden={display}>
        {!display && (
          <BettingBoard
            state={state}
            playerId={playerId}
            interactive={canBet}
            onPlace={place}
            onRemove={remove}
          />
        )}
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
              <button
                className={`chip-btn unit ${chip === 'unit' ? 'selected' : ''}`}
                onClick={() => setChip('unit')}
                title="Unit chip: bets your own custom amount"
              >
                <span className="unit-value">{formatChips(unitValue)}</span>
                <span className="unit-label">UNIT</span>
              </button>
              {chip === 'unit' && (
                <label className="unit-input">
                  Unit value
                  <input
                    type="number"
                    min={1}
                    max={MAX_UNIT}
                    step={1}
                    value={unitDraft}
                    onChange={(e) => updateUnitDraft(e.target.value)}
                    onBlur={() => setUnitDraft(String(unitValue))}
                  />
                </label>
              )}
            </div>
            <div className="actions">
              <button
                className={`lock-btn ${isLocked ? 'locked' : ''}`}
                disabled={state.phase !== 'betting'}
                onClick={async () => check(await api.setLocked(!isLocked))}
                title="When everyone at the table locks in, the ball spins right away"
              >
                {isLocked ? '🔒 Locked in (unlock)' : 'Lock in'}
              </button>
              <button onClick={undo} disabled={!canBet || myBets.length === 0}>Undo</button>
              <button onClick={clear} disabled={!canBet || myBets.length === 0}>Clear</button>
              <button
                onClick={rebet}
                disabled={!canBet || myBets.length > 0 || previousBets.current.length === 0}
              >
                Rebet
              </button>
              {state.settings.winCondition.type === 'none' &&
                me.balance < state.settings.minBet &&
                myBets.length === 0 && (
                  <button className="primary" onClick={async () => check(await api.rebuy())}>
                    Get {state.settings.startingBalance.toLocaleString()} more play chips
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
      {state.phase === 'gameover' && !showSettings && (
        <GameOver
          state={state}
          isHost={isHost}
          onNewGame={async () => check(await api.newGame())}
          onSettings={() => setShowSettings(true)}
        />
      )}
      {showSettings && <SettingsModal settings={state.settings} onClose={() => setShowSettings(false)} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
