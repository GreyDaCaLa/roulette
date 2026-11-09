import { SPOTS_BY_ID, colorOf } from '../../../shared/roulette';
import type { GameState } from '../../../shared/types';
import { useServerNow } from '../game';
import { formatChips } from './BettingBoard';

export function PhaseBanner({ state }: { state: GameState }) {
  const now = useServerNow();
  const secs = state.phaseEndsAt ? Math.max(0, Math.ceil((state.phaseEndsAt - now) / 1000)) : null;

  if (state.phase === 'betting') {
    return (
      <div className="phase betting">
        {secs === null ? 'Place your bets' : <>Bets close in <b>{secs}s</b></>}
      </div>
    );
  }
  if (state.phase === 'spinning') return <div className="phase spinning">No more bets!</div>;
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
                  {p.name}
                  {p.id === playerId && <em> (you)</em>}
                </span>
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
