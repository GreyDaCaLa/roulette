import { useMemo, useState } from 'react';
import { BOARD_H, BOARD_W, colorOf, getSpots, type Spot } from '../../../shared/roulette';
import type { Bet, GameState } from '../../../shared/types';

const CELL_KINDS = new Set(['straight', 'dozen', 'column', 'low', 'high', 'odd', 'even', 'red', 'black']);
const HOTSPOT = 0.36; // edge/corner hotspot size, in cells

const px = (v: number) => `${(v / BOARD_W) * 100}%`;
const py = (v: number) => `${(v / BOARD_H) * 100}%`;

function cellRect(s: Spot) {
  let w = 1;
  let h = 1;
  if (s.cellH) h = s.cellH; // zero cells share the zero column
  else if (s.kind === 'dozen') w = 4;
  else if (s.kind !== 'straight' && s.kind !== 'column') w = 2;
  return { left: px(s.x - w / 2), top: py(s.y - h / 2), width: px(w), height: py(h) };
}

function cellLabel(s: Spot) {
  if (s.kind === 'column') return '2 to 1';
  if (s.kind === 'red' || s.kind === 'black') return <span className={`diamond ${s.kind}`} />;
  return s.label;
}

export function formatChips(n: number) {
  return n >= 1000 ? `${+(n / 1000).toFixed(1)}k` : String(n);
}

interface Props {
  state: GameState;
  playerId: string | null;
  interactive: boolean;
  onPlace: (spot: string) => void;
  onRemove: (spot: string) => void;
  /** Turn the layout 90° (zero at the top) with labels kept upright. */
  rotated?: boolean;
}

export default function BettingBoard({ state, playerId, interactive, onPlace, onRemove, rotated }: Props) {
  const [hover, setHover] = useState<Spot | null>(null);
  const colors = useMemo(() => new Map(state.players.map((p) => [p.id, p])), [state.players]);
  const winner = state.phase === 'results' && state.spin ? state.spin.result : null;

  const betsBySpot = useMemo(() => {
    const m = new Map<string, Bet[]>();
    for (const b of state.bets) m.set(b.spot, [...(m.get(b.spot) ?? []), b]);
    return m;
  }, [state.bets]);

  const highlighted = new Set(hover?.numbers ?? []);
  const spots = getSpots(state.settings.wheel);
  const cells = spots.list.filter((s) => CELL_KINDS.has(s.kind));
  const hotspots = spots.list.filter((s) => !CELL_KINDS.has(s.kind));

  const handlers = (s: Spot) =>
    interactive
      ? {
          onClick: () => onPlace(s.id),
          onContextMenu: (e: React.MouseEvent) => {
            e.preventDefault();
            onRemove(s.id);
          },
          onMouseEnter: () => setHover(s),
          onMouseLeave: () => setHover((h) => (h === s ? null : h)),
        }
      : {};

  return (
    <div className={rotated ? 'board-rotated-frame' : 'board-scroll'}>
      <div className={`board ${interactive ? 'interactive' : ''} ${rotated ? 'rotated' : ''}`}>
        {cells.map((s) => {
          const n = s.numbers[0];
          const color = s.kind === 'straight' ? colorOf(n) : 'felt';
          const isHl =
            s.kind === 'straight' ? highlighted.has(n) : hover?.id === s.id;
          const isWin =
            winner !== null && (s.kind === 'straight' ? n === winner : s.numbers.includes(winner));
          return (
            <div
              key={s.id}
              className={`cell ${color} ${isHl ? 'hl' : ''} ${isWin ? 'win' : ''}`}
              style={cellRect(s)}
              title={`${s.label} — pays ${s.payout} to 1`}
              {...handlers(s)}
            >
              <span className="cell-label">{cellLabel(s)}</span>
            </div>
          );
        })}

        {interactive &&
          hotspots.map((s) => (
            <div
              key={s.id}
              className="hotspot"
              style={{
                left: px(s.x - HOTSPOT / 2),
                top: py(s.y - HOTSPOT / 2),
                width: px(HOTSPOT),
                height: py(HOTSPOT),
              }}
              title={`${s.label} — pays ${s.payout} to 1`}
              {...handlers(s)}
            />
          ))}

        {[...betsBySpot].map(([spotId, bets]) => {
          const s = spots.byId.get(spotId);
          if (!s) return null;
          const won = winner !== null ? s.numbers.includes(winner) : null;
          return (
            <div
              key={spotId}
              className={`chip-stack ${won === true ? 'won' : won === false ? 'lost' : ''}`}
              style={{ left: px(s.x), top: py(s.y) }}
            >
              {bets.map((b, i) => {
                const p = colors.get(b.playerId);
                return (
                  <div
                    key={b.playerId}
                    className={`chip ${b.playerId === playerId ? 'mine' : ''}`}
                    style={{
                      background: p?.color ?? '#888',
                      transform: `translate(calc(-50% + ${i * 22}%), calc(-50% - ${i * 22}%))`,
                    }}
                    title={`${p?.name ?? 'Player'}: ${b.amount} on ${s.label}`}
                  >
                    <span className="chip-amt">{formatChips(b.amount)}</span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
