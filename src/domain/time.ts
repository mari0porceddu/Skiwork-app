/**
 * Date e orari "da calendario" (ora locale di parete), senza fusi orari.
 * - Data: stringa ISO "YYYY-MM-DD".
 * - Ora: stringa "HH:mm".
 * Le durate sono calcolate sull'orario di parete: un'attività 22:00-01:00 dura 3 ore
 * (l'eventuale cambio dell'ora legale non viene considerato, vedi docs/CALCOLI.md).
 */

export type ISODate = string;
export type HHmm = string;

export const MINUTES_PER_DAY = 1440;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidDate(d: string): boolean {
  if (!DATE_RE.test(d)) return false;
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, day));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === day;
}

export function isValidTime(t: string): boolean {
  return TIME_RE.test(t);
}

export function timeToMinutes(t: HHmm): number {
  if (!isValidTime(t)) throw new Error(`Orario non valido: ${t}`);
  const [h, m] = t.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

export function minutesToTime(min: number): HHmm {
  const m = ((min % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Numero di giorni dall'epoca (1970-01-01) per una data. */
export function dayIndex(d: ISODate): number {
  if (!isValidDate(d)) throw new Error(`Data non valida: ${d}`);
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  return Math.floor(Date.UTC(y, m - 1, day) / 86_400_000);
}

export function fromDayIndex(idx: number): ISODate {
  const dt = new Date(idx * 86_400_000);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

export function addDays(d: ISODate, n: number): ISODate {
  return fromDayIndex(dayIndex(d) + n);
}

export function diffDays(a: ISODate, b: ISODate): number {
  return dayIndex(b) - dayIndex(a);
}

/** Giorno della settimana: 0 = lunedì ... 6 = domenica. */
export function weekday(d: ISODate): number {
  // 1970-01-01 era giovedì (3 con lunedì=0)
  return (((dayIndex(d) + 3) % 7) + 7) % 7;
}

export function startOfWeek(d: ISODate): ISODate {
  return addDays(d, -weekday(d));
}

export function startOfMonth(d: ISODate): ISODate {
  return `${d.slice(0, 7)}-01`;
}

export function endOfMonth(d: ISODate): ISODate {
  const [y, m] = d.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${d.slice(0, 7)}-${String(last).padStart(2, '0')}`;
}

export function datesInRange(from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let i = dayIndex(from); i <= dayIndex(to); i++) out.push(fromDayIndex(i));
  return out;
}

export function todayISO(now: Date = new Date()): ISODate {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function nowHHmm(now: Date = new Date()): HHmm {
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

/**
 * Durata in minuti tra inizio e fine. Se la fine è <= inizio, l'attività termina il giorno dopo
 * (attraversa la mezzanotte). Inizio == fine non è ammesso (durata zero).
 */
export function spanMinutes(start: HHmm, end: HHmm): number {
  const s = timeToMinutes(start);
  const e = timeToMinutes(end);
  if (s === e) return 0;
  return e > s ? e - s : e + MINUTES_PER_DAY - s;
}

export function crossesMidnight(start: HHmm, end: HHmm): boolean {
  return timeToMinutes(end) <= timeToMinutes(start) && start !== end;
}

/** Intervallo assoluto [inizio, fine) in minuti dall'epoca, per confronti tra giorni diversi. */
export interface AbsInterval {
  start: number;
  end: number;
}

export function absInterval(date: ISODate, start: HHmm, end: HHmm): AbsInterval {
  const s = dayIndex(date) * MINUTES_PER_DAY + timeToMinutes(start);
  return { start: s, end: s + spanMinutes(start, end) };
}

export function formatMinutesAsHours(min: number): string {
  const sign = min < 0 ? '-' : '';
  const a = Math.abs(min);
  const h = Math.floor(a / 60);
  const m = a % 60;
  return m === 0 ? `${sign}${h} h` : `${sign}${h} h ${String(m).padStart(2, '0')}′`;
}

const WEEKDAYS_SHORT = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
const MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

export function weekdayShort(i: number): string {
  return WEEKDAYS_SHORT[i] ?? '';
}

export function monthName(m: number): string {
  return MONTHS[m] ?? '';
}

/** "lun 13 ottobre" */
export function formatDateLong(d: ISODate): string {
  const [, m, day] = d.split('-').map(Number) as [number, number, number];
  return `${WEEKDAYS_SHORT[weekday(d)]!.toLowerCase()} ${day} ${MONTHS[m - 1]}`;
}

/** "13/10/2026" */
export function formatDateShort(d: ISODate): string {
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
}
