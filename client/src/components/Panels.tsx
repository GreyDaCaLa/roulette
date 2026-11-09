import { SPOTS_BY_ID, colorOf } from '../../../shared/roulette';
import { describeWinCondition } from '../../../shared/settings';
import type { GameState } from '../../../shared/types';
import { useServerNow } from '../game';
import { formatChips } from './BettingBoard';

export function PhaseBanner({ state }: { state: GameState }) {
  const now = useServerNow();
  const secs = state.phaseEndsAt ? Math.max(0, Math.ceil((state.phaseEndsAt - now) / 1000)) : null;

  if (state.phase === 'betting') {
    const seated = state.players.filter((p) => p.connected);
    const locked = seated.filter((p) => state.lockedIds.includes(p.id)).length;
    return (
      <div className="phase betting">
        {secs === null ? 'Place your bets' : <>Bets close in <b>{secs}s</b></>}
        {locked > 0 && (
          <span className="lock-count">
            🔒 {locked}/{seated.length} locked in
          </span>
        )}
      </div>
    );
  }
  if (state.phase === 'spinning') return <div className="phase spinning">No more bets!</div>;
  if (state.phase === 'gameover') return <div className="phase spinning">Game over</div>;
  const n = state.spin?.result ?? 0;
  return (
    <div className="phase results">
      <span className={`pill ${colorOf(n)}`}>{n}</span> {colorOf(n)} wins
    </div>
  );
}

export function PlayersPanel({ state, playerId }: { state: GameState; playerId: string | null }) {
  const round = state.phase === 'results' && state.lastRound?.roundId === state.roundId ? state.lastRound : null;
  const players = [...state.players].sort(
    (a, b) => Number(b.connected) - Number(a.connected) || b.balance - a.balance,
  );

  return (
    <div className="panel players">
      <h2>Players</h2>
      {players.length === 0 && <p className="muted">Nobody at the table yet.</p>}
      <ul>
        {players.map((p) => {
          const bets = state.bets.filter((b) => b.playerId === p.id);
          const staked = bets.reduce((t, b) => t + b.amount, 0);
          const result = round?.players.find((r) => r.playerId === p.id);
          return (
            <li key={p.id} className={p.connected ? '' : 'offline'}>
              <div className="player-row">
                <span className="dot" style={{ background: p.color }} />
                <span className="name">
                  {p.id === state.hostId && <span title="Host">👑 </span>}
                  {p.name}
                  {p.id === playerId && <em> (you)</em>}
                </span>
                {state.phase === 'betting' && state.lockedIds.includes(p.id) && (
                  <span title="Locked in">🔒</span>
                )}
                <span className="balance">{p.balance.toLocaleString()}</span>
              </div>
              {(staked > 0 || result) && (
                <div className="player-bets">
                  {result ? (
                    <span className={result.net >= 0 ? 'net up' : 'net down'}>
                      {result.net >= 0 ? '+' : ''}
                      {result.net.toLocaleString()}
                    </span>
                  ) : (
                    <span className="muted">on table {staked.toLocaleString()}</span>
                  )}
                  <span className="bet-list">
                    {bets.map((b) => (
                      <span key={b.spot} className="bet-tag">
                        {SPOTS_BY_ID.get(b.spot)?.label} · {formatChips(b.amount)}
                        {b.forced && <em className="auto"> auto</em>}
                      </span>
                    ))}
                  </span>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function MatchStatus({ state }: { state: GameState }) {
  const wc = state.settings.winCondition;
  let progress: string | null = null;
  if (wc.type === 'mostChips') progress = `Spin ${Math.min(state.match.spinsPlayed, wc.spins)} / ${wc.spins}`;
  if (wc.type === 'target') {
    const leader = Math.max(0, ...state.players.map((p) => p.balance));
    progress = `Leader: ${leader.toLocaleString()} / ${wc.amount.toLocaleString()}`;
  }
  return (
    <div className="panel match">
      <h2>Table rules</h2>
      <div>{describeWinCondition(wc)}</div>
      {progress && <div className="match-progress">{progress}</div>}
      <div className="muted rules-line">
        Start {state.settings.startingBalance.toLocaleString()} · Min bet {state.settings.minBet} · Max/spot{' '}
        {state.settings.maxBetPerSpot.toLocaleString()} · {state.settings.bettingSeconds}s to bet
        {state.settings.forcedMinBet && ' · Forced min bet on black'}
      </div>
    </div>
  );
}

export function GameOver({
  state,
  isHost,
  onNewGame,
  onSettings,
}: {
  state: GameState;
  isHost: boolean;
  onNewGame: () => void;
  onSettings: () => void;
}) {
  const winners = state.players.filter((p) => state.match.winners.includes(p.id));
  return (
    <div className="modal-backdrop">
      <div className="modal gameover">
        <h2>{winners.length > 1 ? 'Winners!' : 'Winner!'}</h2>
        <p className="muted">{describeWinCondition(state.settings.winCondition)}</p>
        <ul className="winners">
          {winners.map((p) => (
            <li key={p.id}>
              <span className="dot" style={{ background: p.color }} /> {p.name}
              <b>{p.balance.toLocaleString()} chips</b>
            </li>
          ))}
        </ul>
        {isHost ? (
          <div className="modal-actions">
            <button onClick={onSettings}>Change settings</button>
            <button className="primary" onClick={onNewGame}>Play again</button>
          </div>
        ) : (
          <p className="muted">Waiting for the host to start a new game…</p>
        )}
      </div>
    </div>
  );
}

export function History({ history }: { history: number[] }) {
  return (
    <div className="panel history">
      <h2>Last results</h2>
      <div className="history-row">
        {history.length === 0 && <span className="muted">No spins yet.</span>}
        {history.map((n, i) => (
          <span key={i} className={`pill ${colorOf(n)}`}>
            {n}
          </span>
        ))}
      </div>
    </div>
  );
}
