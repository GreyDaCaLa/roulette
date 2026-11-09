import { useEffect, useState, useSyncExternalStore } from 'react';
import { io } from 'socket.io-client';
import type { Ack, GameState, JoinAck, TableSettings } from '../../shared/types';

// Same origin: Vite proxies /socket.io to the game server in dev,
// and the game server serves the built client in production.
const socket = io();

interface Store {
  state: GameState | null;
  playerId: string | null;
  connected: boolean;
  rejoining: boolean;
}

const TOKEN_KEY = 'roulette.token';
const NAME_KEY = 'roulette.name';

function load(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function save(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

let store: Store = { state: null, playerId: null, connected: false, rejoining: !!load(NAME_KEY) };
let clockOffset = 0;
const listeners = new Set<() => void>();

function set(patch: Partial<Store>) {
  store = { ...store, ...patch };
  listeners.forEach((l) => l());
}

socket.on('state', (state: GameState) => {
  clockOffset = state.serverNow - Date.now();
  set({ state });
});

socket.on('connect', () => {
  set({ connected: true });
  const name = load(NAME_KEY);
  if (name && !isDisplayMode()) void join(name);
});

socket.on('disconnect', () => set({ connected: false }));

export function isDisplayMode() {
  return new URLSearchParams(location.search).has('display');
}

/** Current time on the server's clock (ms). */
export function serverNow() {
  return Date.now() + clockOffset;
}

export function useGame() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => store,
  );
}

/** Re-renders periodically and returns the server-clock time. */
export function useServerNow(intervalMs = 200) {
  const [now, setNow] = useState(serverNow);
  useEffect(() => {
    const id = setInterval(() => setNow(serverNow()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

async function emit<T extends Ack = Ack>(event: string, data?: unknown): Promise<T> {
  try {
    return await socket.timeout(5000).emitWithAck(event, data);
  } catch {
    return { ok: false, error: 'Server did not respond' } as T;
  }
}

export async function join(name: string) {
  save(NAME_KEY, name);
  const res = await emit<JoinAck>('join', { name, token: load(TOKEN_KEY) });
  if (res.ok && res.token && res.playerId) {
    save(TOKEN_KEY, res.token);
    set({ playerId: res.playerId, rejoining: false });
  } else {
    set({ rejoining: false });
  }
  return res;
}

export const api = {
  placeBet: (spot: string, amount: number) => emit('bet:place', { spot, amount }),
  removeBet: (spot: string, amount?: number) => emit('bet:remove', { spot, amount }),
  clearBets: () => emit('bet:clear'),
  setLocked: (locked: boolean) => emit('lock', { locked }),
  rebuy: () => emit('rebuy'),
  updateSettings: (settings: TableSettings) => emit('settings:update', settings),
  newGame: () => emit('game:new'),
};
