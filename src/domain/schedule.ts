/**
 * Conflitti di calendario, ricorrenze e calcolo degli slot liberi.
 * Regole esplicite, documentate in docs/CALCOLI.md.
 */
import {
  absInterval,
  addDays,
  dayIndex,
  datesInRange,
  MINUTES_PER_DAY,
  minutesToTime,
  timeToMinutes,
  weekday,
  type AbsInterval,
  type HHmm,
  type ISODate,
} from './time';
import type { Activity, AvailabilityRule, Client } from './types';

export type ScheduleItem = Pick<Activity, 'id' | 'date' | 'start' | 'end' | 'status' | 'clientId' | 'location' | 'title'>;

/** Le attività cancellate non occupano tempo. */
export function occupiesTime(a: Pick<Activity, 'status'>): boolean {
  return a.status !== 'cancelled';
}

export interface Conflict {
  aId: string;
  bId: string;
  kind: 'overlap' | 'travel';
  /** Minuti di sovrapposizione o di trasferimento mancanti. */
  minutes: number;
}

/**
 * Minuti di trasferimento richiesti tra due impegni consecutivi: se luogo o committente
 * cambiano, si usa il massimo tra i tempi di trasferimento dei due committenti
 * (e il tempo predefinito delle impostazioni).
 */
export function travelBetween(a: ScheduleItem, b: ScheduleItem, clients: Map<string, Client>, defaultTravel: number): number {
  const sameClient = a.clientId !== null && a.clientId === b.clientId;
  const sameLocation = a.location.trim().toLowerCase() === b.location.trim().toLowerCase();
  if (sameClient && sameLocation) return 0;
  if (sameLocation && a.location.trim() !== '') return 0;
  const ta = a.clientId ? (clients.get(a.clientId)?.travelMinutes ?? 0) : 0;
  const tb = b.clientId ? (clients.get(b.clientId)?.travelMinutes ?? 0) : 0;
  return Math.max(ta, tb, defaultTravel);
}

export function detectConflicts(items: ScheduleItem[], clients: Map<string, Client> = new Map(), defaultTravel = 0): Conflict[] {
  const active = items
    .filter(occupiesTime)
    .map((i) => ({ item: i, iv: absInterval(i.date, i.start, i.end) }))
    .sort((x, y) => x.iv.start - y.iv.start || x.iv.end - y.iv.end);
  const out: Conflict[] = [];
  for (let i = 0; i < active.length; i++) {
    const a = active[i]!;
    for (let j = i + 1; j < active.length; j++) {
      const b = active[j]!;
      // il massimo tempo di trasferimento possibile limita la ricerca
      if (b.iv.start >= a.iv.end + MINUTES_PER_DAY) break;
      if (b.iv.start < a.iv.end) {
        out.push({ aId: a.item.id, bId: b.item.id, kind: 'overlap', minutes: Math.min(a.iv.end, b.iv.end) - b.iv.start });
        continue;
      }
      const need = travelBetween(a.item, b.item, clients, defaultTravel);
      const gap = b.iv.start - a.iv.end;
      if (need > 0 && gap < need) out.push({ aId: a.item.id, bId: b.item.id, kind: 'travel', minutes: need - gap });
    }
  }
  return out;
}

/** Ricorrenza settimanale: date tra start e until nei giorni indicati (max 366 occorrenze). */
export function expandWeekly(startDate: ISODate, untilDate: ISODate, weekdays: number[], max = 366): ISODate[] {
  if (dayIndex(untilDate) < dayIndex(startDate)) return [];
  const set = new Set(weekdays);
  const out: ISODate[] = [];
  for (const d of datesInRange(startDate, untilDate)) {
    if (set.has(weekday(d))) out.push(d);
    if (out.length >= max) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Intervalli nel giorno (minuti dalla mezzanotte, [start, end), 0..1440)

export interface DayInterval {
  start: number;
  end: number;
}

export function normalize(intervals: DayInterval[]): DayInterval[] {
  const sorted = intervals.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  const out: DayInterval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push({ ...i });
  }
  return out;
}

export function subtract(base: DayInterval[], remove: DayInterval[]): DayInterval[] {
  let result = normalize(base);
  for (const r of normalize(remove)) {
    const next: DayInterval[] = [];
    for (const b of result) {
      if (r.end <= b.start || r.start >= b.end) {
        next.push(b);
        continue;
      }
      if (r.start > b.start) next.push({ start: b.start, end: r.start });
      if (r.end < b.end) next.push({ start: r.end, end: b.end });
    }
    result = next;
  }
  return result;
}

export function intersect(a: DayInterval[], b: DayInterval[]): DayInterval[] {
  const out: DayInterval[] = [];
  for (const x of normalize(a)) for (const y of normalize(b)) {
    const s = Math.max(x.start, y.start);
    const e = Math.min(x.end, y.end);
    if (e > s) out.push({ start: s, end: e });
  }
  return normalize(out);
}

function ruleInterval(start: HHmm, end: HHmm): DayInterval {
  const s = timeToMinutes(start);
  const e = timeToMinutes(end);
  // Le regole di disponibilità non attraversano la mezzanotte: "fine" 00:00 = fine giornata.
  return { start: s, end: e === 0 ? MINUTES_PER_DAY : e };
}

/** Porzione di un impegno (eventualmente a cavallo della mezzanotte) che cade nel giorno indicato. */
export function clipToDay(iv: AbsInterval, date: ISODate, padBefore = 0, padAfter = 0): DayInterval | null {
  const dayStart = dayIndex(date) * MINUTES_PER_DAY;
  const s = Math.max(iv.start - padBefore, dayStart) - dayStart;
  const e = Math.min(iv.end + padAfter, dayStart + MINUTES_PER_DAY) - dayStart;
  return e > s ? { start: s, end: e } : null;
}

export function rulesForDate(rules: AvailabilityRule[], date: ISODate): AvailabilityRule[] {
  const inValidity = (r: AvailabilityRule) => (r.validFrom === null || r.validFrom <= date) && (r.validTo === null || date <= r.validTo);
  const exceptions = rules.filter((r) => r.date === date);
  // Eccezioni per data: sostituiscono interamente le regole ricorrenti di quel giorno.
  if (exceptions.length > 0) return exceptions;
  const wd = weekday(date);
  return rules.filter((r) => r.date === null && r.weekdays.includes(wd) && inValidity(r));
}

export interface DayAvailability {
  date: ISODate;
  /** 1. Tempo non occupato da impegni (pianificati, confermati, completati). */
  unoccupied: DayInterval[];
  /** 2. Tempo disponibile a lavorare (regole "disponibile" + "accetto lezioni" − "non disponibile"). */
  available: DayInterval[];
  /** 3. Tempo riservato a proposte non ancora confermate (stato "pianificato"). */
  tentative: DayInterval[];
  /** Tempo occupato da impegni confermati/completati, inclusi i trasferimenti. */
  busy: DayInterval[];
  /** Slot liberi per nuove lezioni: finestre "accetto lezioni" (o, se assenti, "disponibile") − occupato − proposte. */
  freeSlots: DayInterval[];
  /** true se non ci sono regole di disponibilità per il giorno. */
  noRules: boolean;
}

export interface AvailabilityOptions {
  clients?: Map<string, Client>;
  defaultTravel?: number;
  minSlotMinutes?: number;
}

export function computeDayAvailability(
  date: ISODate,
  rules: AvailabilityRule[],
  activities: ScheduleItem[],
  opts: AvailabilityOptions = {},
): DayAvailability {
  const { clients = new Map(), defaultTravel = 0, minSlotMinutes = 0 } = opts;
  const dayRules = rulesForDate(rules, date);
  const of = (k: AvailabilityRule['kind']) => dayRules.filter((r) => r.kind === k).map((r) => ruleInterval(r.start, r.end));
  const unavailable = of('unavailable');
  const bookable = of('bookable');
  const available = subtract([...of('available'), ...bookable], unavailable);

  const busy: DayInterval[] = [];
  const tentative: DayInterval[] = [];
  const occupiedRaw: DayInterval[] = [];
  for (const a of activities) {
    if (!occupiesTime(a)) continue;
    const iv = absInterval(a.date, a.start, a.end);
    const raw = clipToDay(iv, date);
    const travel = a.clientId ? (clients.get(a.clientId)?.travelMinutes ?? 0) : 0;
    const pad = Math.max(travel, defaultTravel);
    const padded = clipToDay(iv, date, pad, pad);
    if (raw) occupiedRaw.push(raw);
    if (!padded) continue;
    if (a.status === 'planned') tentative.push(padded);
    else busy.push(padded);
  }

  const windows = bookable.length > 0 ? subtract(bookable, unavailable) : available;
  const freeSlots = subtract(windows, [...busy, ...tentative]).filter((s) => s.end - s.start >= minSlotMinutes);

  return {
    date,
    unoccupied: subtract([{ start: 0, end: MINUTES_PER_DAY }], occupiedRaw),
    available: normalize(available),
    tentative: normalize(tentative),
    busy: normalize(busy),
    freeSlots,
    noRules: dayRules.length === 0,
  };
}

export function formatInterval(i: DayInterval): string {
  return `${minutesToTime(i.start)}–${i.end === MINUTES_PER_DAY ? '24:00' : minutesToTime(i.end)}`;
}

export function totalMinutes(intervals: DayInterval[]): number {
  return intervals.reduce((s, i) => s + (i.end - i.start), 0);
}

export function weekDates(anyDate: ISODate): ISODate[] {
  const start = addDays(anyDate, -weekday(anyDate));
  return datesInRange(start, addDays(start, 6));
}
