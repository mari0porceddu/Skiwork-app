import { isValidTime, spanMinutes, type HHmm } from './time';
import type { Activity, Client } from './types';

/** Turni con orari regolabili per committente: le attività segnate con un turno ne seguono gli orari. */
export type ShiftKey = 'morning' | 'afternoon' | 'full_day';

export const SHIFT_KEYS: ShiftKey[] = ['morning', 'afternoon', 'full_day'];

export const SHIFT_LABEL: Record<ShiftKey, string> = {
  morning: 'Mattina',
  afternoon: 'Pomeriggio',
  full_day: 'Giornata intera',
};

export interface ShiftTimes {
  start: HHmm;
  end: HHmm;
}

export type ClientShifts = Partial<Record<ShiftKey, ShiftTimes>>;

/** Orari del turno per il committente, se configurati e validi. */
export function shiftTimes(client: Pick<Client, 'shifts'> | undefined | null, key: ShiftKey): ShiftTimes | null {
  const t = client?.shifts?.[key];
  if (!t || !isValidTime(t.start) || !isValidTime(t.end) || spanMinutes(t.start, t.end) === 0) return null;
  return t;
}

/**
 * Attività da riallineare dopo una modifica degli orari dei turni del committente.
 * Solo attività pianificate o confermate: quelle completate o cancellate conservano gli orari registrati.
 */
export function planShiftRealign(client: Pick<Client, 'id' | 'shifts'>, activities: Activity[]): Activity[] {
  const out: Activity[] = [];
  for (const a of activities) {
    if (a.clientId !== client.id || !a.shift) continue;
    if (a.status !== 'planned' && a.status !== 'confirmed') continue;
    const t = shiftTimes(client, a.shift);
    if (!t || (t.start === a.start && t.end === a.end)) continue;
    out.push({ ...a, start: t.start, end: t.end });
  }
  return out;
}
