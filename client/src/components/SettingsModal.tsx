import { useState } from 'react';
import { WHEEL_TYPES, type WheelType } from '../../../shared/roulette';
import { BOUNDS, validateSettings } from '../../../shared/settings';
import type { TableSettings, WinCondition } from '../../../shared/types';
import { api } from '../game';

interface Props {
  settings: TableSettings;
  onClose: () => void;
}

export default function SettingsModal({ settings, onClose }: Props) {
  const [form, setForm] = useState({
    wheel: settings.wheel as WheelType,
    startingBalance: String(settings.startingBalance),
    minBet: String(settings.minBet),
    maxBetPerSpot: String(settings.maxBetPerSpot),
    bettingSeconds: String(settings.bettingSeconds),
    forcedMinBet: settings.forcedMinBet,
    winType: settings.winCondition.type as WinCondition['type'],
    spins: String(settings.winCondition.type === 'mostChips' ? settings.winCondition.spins : 10),
    target: String(
      settings.winCondition.type === 'target' ? settings.winCondition.amount : settings.startingBalance * 5,
    ),
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  type TextKey = Exclude<keyof typeof form, 'forcedMinBet' | 'wheel'>;
  const field = (key: TextKey) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value })),
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const winCondition =
      form.winType === 'mostChips'
        ? { type: 'mostChips', spins: Number(form.spins) }
        : form.winType === 'target'
          ? { type: 'target', amount: Number(form.target) }
          : { type: 'none' };
    const check = validateSettings({
      wheel: form.wheel,
      startingBalance: Number(form.startingBalance),
      minBet: Number(form.minBet),
      maxBetPerSpot: Number(form.maxBetPerSpot),
      bettingSeconds: Number(form.bettingSeconds),
      forcedMinBet: form.forcedMinBet,
      winCondition,
    });
    if (!check.settings) return setError(check.error);
    setBusy(true);
    const res = await api.updateSettings(check.settings);
    setBusy(false);
    if (res.ok) onClose();
    else setError(res.error ?? 'Could not save settings');
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>Table settings</h2>

        <label className="select-field">
          Table type
          <select
            value={form.wheel}
            onChange={(e) => setForm((f) => ({ ...f, wheel: e.target.value as WheelType }))}
          >
            {WHEEL_TYPES.map((w) => (
              <option key={w.id} value={w.id}>
                {w.label}
              </option>
            ))}
          </select>
        </label>

        <div className="form-grid">
          <label>
            Starting chips
            <input type="number" min={BOUNDS.startingBalance[0]} max={BOUNDS.startingBalance[1]} {...field('startingBalance')} />
          </label>
          <label>
            Betting time (seconds)
            <input type="number" min={BOUNDS.bettingSeconds[0]} max={BOUNDS.bettingSeconds[1]} {...field('bettingSeconds')} />
          </label>
          <label>
            Minimum bet
            <input type="number" min={BOUNDS.minBet[0]} max={BOUNDS.minBet[1]} {...field('minBet')} />
          </label>
          <label>
            Max bet per spot
            <input type="number" min={BOUNDS.maxBetPerSpot[0]} max={BOUNDS.maxBetPerSpot[1]} {...field('maxBetPerSpot')} />
          </label>
        </div>

        <label className="radio checkbox">
          <input
            type="checkbox"
            checked={form.forcedMinBet}
            onChange={(e) => setForm((f) => ({ ...f, forcedMinBet: e.target.checked }))}
          />
          <span>
            Forced minimum bet
            <span className="muted"> (players with no bet when betting closes auto-bet the minimum on black)</span>
          </span>
        </label>

        <fieldset className="win-options">
          <legend>Win condition</legend>
          <label className="radio">
            <input type="radio" name="win" checked={form.winType === 'none'} onChange={() => setForm((f) => ({ ...f, winType: 'none' }))} />
            No win condition <span className="muted">(free play, rebuys allowed)</span>
          </label>
          <label className="radio">
            <input type="radio" name="win" checked={form.winType === 'mostChips'} onChange={() => setForm((f) => ({ ...f, winType: 'mostChips' }))} />
            Most chips after
            <input type="number" className="inline" min={BOUNDS.spins[0]} max={BOUNDS.spins[1]} disabled={form.winType !== 'mostChips'} {...field('spins')} />
            spins
          </label>
          <label className="radio">
            <input type="radio" name="win" checked={form.winType === 'target'} onChange={() => setForm((f) => ({ ...f, winType: 'target' }))} />
            First to reach
            <input type="number" className="inline wide" min={BOUNDS.target[0]} max={BOUNDS.target[1]} disabled={form.winType !== 'target'} {...field('target')} />
            chips
          </label>
        </fieldset>

        <p className="warning">Saving starts a new game: everyone's chips reset to the starting amount.</p>
        {error && <p className="form-error">{error}</p>}

        <div className="modal-actions">
          <button type="button" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={busy}>Save &amp; start new game</button>
        </div>
      </form>
    </div>
  );
}
