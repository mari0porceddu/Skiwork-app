/**
 * Regole pure per la sincronizzazione con il calendario Google "SkiWork".
 * Deterministiche e testabili: le chiamate di rete sono in src/sync/calendar.ts.
 */
import { addDays, crossesMidnight, isValidTime, type HHmm, type ISODate } from './time';
import { ACTIVITY_TYPE_LABEL, LESSON_LEVEL_LABEL, type Activity } from './types';
import { SHIFT_LABEL } from './shifts';

export interface GEventTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

export interface GEvent {
  id: string;
  status?: 'confirmed' | 'tentative' | 'cancelled';
  summary?: string;
  description?: string;
  location?: string;
  start?: GEventTime;
  end?: GEventTime;
  updated?: string;
  extendedProperties?: { private?: Record<string, string> };
}

/** Orari usati per gli eventi "tutto il giorno" creati su Google. */
export const ALL_DAY_START: HHmm = '09:00';
export const ALL_DAY_END: HHmm = '16:00';
const MAX_ALL_DAY_SPAN = 14;

const pad = (n: number) => String(n).padStart(2, '0');

function localWallClock(iso: string): { date: ISODate; time: HHmm } {
  const d = new Date(iso);
  return { date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}` };
}

/** Evento da inviare a Google per un'attività. Orari locali con il fuso del dispositivo. */
export function activityToEvent(a: Activity, clientName: string | undefined, timeZone: string): Omit<GEvent, 'id'> {
  const endDate = crossesMidnight(a.start, a.end) ? addDays(a.date, 1) : a.date;
  const summary = [a.title || ACTIVITY_TYPE_LABEL[a.type], clientName].filter(Boolean).join(' · ');
  const details = [a.shift ? SHIFT_LABEL[a.shift] : null, a.level ? LESSON_LEVEL_LABEL[a.level] : null].filter(Boolean).join(' · ');
  return {
    summary: a.status === 'cancelled' ? `Cancellato: ${summary}` : summary,
    location: a.location || undefined,
    description: [details, a.notes].filter(Boolean).join('\n\n') || undefined,
    start: { dateTime: `${a.date}T${a.start}:00`, timeZone },
    end: { dateTime: `${endDate}T${a.end}:00`, timeZone },
    extendedProperties: { private: { skiworkId: a.id } },
  };
}

/** Giorni e orari locali di un evento Google (più giorni se "tutto il giorno" su più date). */
export function eventSlots(ev: GEvent): { date: ISODate; start: HHmm; end: HHmm; allDay: boolean }[] {
  if (ev.start?.dateTime && ev.end?.dateTime) {
    const s = localWallClock(ev.start.dateTime);
    const e = localWallClock(ev.end.dateTime);
    if (!isValidTime(s.time) || !isValidTime(e.time)) return [];
    return [{ date: s.date, start: s.time, end: e.time === s.time ? s.time : e.time, allDay: false }];
  }
  if (ev.start?.date) {
    const out = [];
    const last = ev.end?.date ? addDays(ev.end.date, -1) : ev.start.date; // la data di fine è esclusa
    for (let d = ev.start.date, i = 0; d <= last && i < MAX_ALL_DAY_SPAN; d = addDays(d, 1), i++) out.push({ date: d, start: ALL_DAY_START, end: ALL_DAY_END, allDay: true });
    return out;
  }
  return [];
}

/** L'attività va (re)inviata a Google: modificata dopo l'ultimo invio. */
export function needsPush(a: Activity): boolean {
  return a.gcalSyncedAt !== a.updatedAt;
}

type EventChanges = Partial<Pick<Activity, 'date' | 'start' | 'end' | 'location' | 'title' | 'notes'>>;

export type PullAction =
  | { kind: 'create'; event: GEvent; slots: ReturnType<typeof eventSlots> }
  | { kind: 'update'; event: GEvent; activity: Activity; changes: EventChanges }
  | { kind: 'cancel'; event: GEvent; activity: Activity }
  | { kind: 'seen'; event: GEvent; activity: Activity };

/**
 * Cosa fare con gli eventi arrivati da Google.
 * - evento nuovo creato su Google: nuova attività "da completare";
 * - evento collegato modificato su Google dopo l'ultima modifica in SkiWork: si aggiornano data, orari e luogo
 *   (titolo e note solo per le attività nate su Google ancora da completare);
 * - evento eliminato su Google: attività pianificata o confermata → cancellata; completate intatte.
 */
export function planPull(events: GEvent[], activities: Activity[]): PullAction[] {
  const byEvent = new Map(activities.filter((a) => a.gcalEventId).map((a) => [a.gcalEventId!, a]));
  const byId = new Map(activities.map((a) => [a.id, a]));
  const out: PullAction[] = [];
  for (const ev of events) {
    const linked = byEvent.get(ev.id) ?? byId.get(ev.extendedProperties?.private?.skiworkId ?? '');
    if (!linked) {
      if (ev.status === 'cancelled') continue;
      // Evento creato da SkiWork per un'attività poi eliminata: non va reimportato.
      if (ev.extendedProperties?.private?.skiworkId) continue;
      const slots = eventSlots(ev);
      if (slots.length) out.push({ kind: 'create', event: ev, slots });
      continue;
    }
    if (ev.updated && ev.updated === linked.gcalUpdated) continue; // già visto (anche i nostri invii)
    if (ev.status === 'cancelled') {
      if (linked.status === 'planned' || linked.status === 'confirmed') out.push({ kind: 'cancel', event: ev, activity: linked });
      else out.push({ kind: 'seen', event: ev, activity: linked });
      continue;
    }
    // Modificata anche in SkiWork dopo l'ultimo invio: vince SkiWork (verrà reinviata).
    if (needsPush(linked) && linked.gcalSyncedAt !== undefined) {
      out.push({ kind: 'seen', event: ev, activity: linked });
      continue;
    }
    const slot = eventSlots(ev)[0];
    const changes: EventChanges = {};
    if (slot) {
      if (slot.date !== linked.date) changes.date = slot.date;
      if (slot.start !== linked.start) changes.start = slot.start;
      if (slot.end !== linked.end) changes.end = slot.end;
    }
    if ((ev.location ?? '') !== linked.location) changes.location = ev.location ?? '';
    if (linked.needsDetails) {
      if ((ev.summary ?? '') !== linked.title) changes.title = ev.summary ?? '';
      if ((ev.description ?? '') !== linked.notes) changes.notes = ev.description ?? '';
    }
    out.push(Object.keys(changes).length ? { kind: 'update', event: ev, activity: linked, changes } : { kind: 'seen', event: ev, activity: linked });
  }
  return out;
}
