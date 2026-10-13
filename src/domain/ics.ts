/**
 * Importazione/esportazione iCalendar (RFC 5545), sottoinsieme sufficiente per Apple Calendar.
 * Gli orari esportati sono "floating" (ora locale), coerenti con il modello dati.
 */
import { addDays, crossesMidnight, isValidDate, isValidTime, type HHmm, type ISODate } from './time';
import type { Activity } from './types';
import { ACTIVITY_STATUS_LABEL, ACTIVITY_TYPE_LABEL } from './types';

function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\;');
}

function unesc(s: string): string {
  return s.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\;/g, ';').replace(/\\\\/g, '\\');
}

function fold(line: string): string {
  // righe max 75 ottetti: piegatura semplice su caratteri (sufficiente per testo prevalentemente ASCII)
  const out: string[] = [];
  let rest = line;
  while (rest.length > 74) {
    out.push(rest.slice(0, 74));
    rest = ' ' + rest.slice(74);
  }
  out.push(rest);
  return out.join('\r\n');
}

const icsDateTime = (d: ISODate, t: HHmm) => `${d.replace(/-/g, '')}T${t.replace(':', '')}00`;

export function activityUid(a: Pick<Activity, 'id' | 'externalUid'>): string {
  return a.externalUid ?? `${a.id}@skiwork`;
}

export function exportIcs(activities: Activity[], clientNames: Map<string, string>, stamp: Date = new Date()): string {
  const dtstamp = stamp.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SkiWork//IT', 'CALSCALE:GREGORIAN'];
  for (const a of activities) {
    const endDate = crossesMidnight(a.start, a.end) ? addDays(a.date, 1) : a.date;
    const client = a.clientId ? clientNames.get(a.clientId) : undefined;
    const desc = [ACTIVITY_TYPE_LABEL[a.type], client, ACTIVITY_STATUS_LABEL[a.status], a.notes].filter(Boolean).join('\n');
    lines.push(
      'BEGIN:VEVENT',
      `UID:${esc(activityUid(a))}`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART:${icsDateTime(a.date, a.start)}`,
      `DTEND:${icsDateTime(endDate, a.end)}`,
      `SUMMARY:${esc(a.title || ACTIVITY_TYPE_LABEL[a.type])}`,
    );
    if (a.location) lines.push(`LOCATION:${esc(a.location)}`);
    if (desc) lines.push(`DESCRIPTION:${esc(desc)}`);
    lines.push(`STATUS:${a.status === 'cancelled' ? 'CANCELLED' : a.status === 'planned' ? 'TENTATIVE' : 'CONFIRMED'}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

export interface IcsEvent {
  uid: string;
  title: string;
  date: ISODate;
  start: HHmm;
  end: HHmm;
  location: string;
  notes: string;
  cancelled: boolean;
  allDay: boolean;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Converte un valore DTSTART/DTEND in data e ora locali. */
function parseDateValue(value: string, params: string): { date: ISODate; time: HHmm; allDay: boolean } | null {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, hh, mm, , z] = m;
  if (hh === undefined || /VALUE=DATE(?!-)/.test(params)) {
    return { date: `${y}-${mo}-${d}`, time: '00:00', allDay: true };
  }
  if (z) {
    // UTC -> ora locale del dispositivo
    const dt = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mm)));
    return {
      date: `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`,
      time: `${pad2(dt.getHours())}:${pad2(dt.getMinutes())}`,
      allDay: false,
    };
  }
  // ora "floating" o con TZID: interpretata come ora locale (limite documentato)
  return { date: `${y}-${mo}-${d}`, time: `${hh}:${mm}`, allDay: false };
}

export interface IcsParseResult {
  events: IcsEvent[];
  skipped: { uid: string; reason: string }[];
}

export function parseIcs(text: string): IcsParseResult {
  const unfolded = text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
  const lines = unfolded.split('\n');
  const events: IcsEvent[] = [];
  const skipped: IcsParseResult['skipped'] = [];
  let cur: Record<string, { value: string; params: string }> | null = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      cur = {};
      continue;
    }
    if (line === 'END:VEVENT' && cur) {
      const uid = cur.UID?.value ?? '';
      const ds = cur.DTSTART ? parseDateValue(cur.DTSTART.value, cur.DTSTART.params) : null;
      const de = cur.DTEND ? parseDateValue(cur.DTEND.value, cur.DTEND.params) : null;
      if (!uid) skipped.push({ uid: '(senza UID)', reason: 'UID mancante' });
      else if (cur.RRULE) skipped.push({ uid, reason: 'Eventi ricorrenti non supportati: esporta le singole occorrenze' });
      else if (!ds || !isValidDate(ds.date) || !isValidTime(ds.time)) skipped.push({ uid, reason: 'Data di inizio non valida' });
      else if (ds.allDay) skipped.push({ uid, reason: 'Evento di giornata intera non importato' });
      else {
        const end = de && !de.allDay ? de.time : ds.time;
        events.push({
          uid,
          title: unesc(cur.SUMMARY?.value ?? ''),
          date: ds.date,
          start: ds.time,
          end: end === ds.time ? addMinutesHHmm(ds.time, 60) : end,
          location: unesc(cur.LOCATION?.value ?? ''),
          notes: unesc(cur.DESCRIPTION?.value ?? ''),
          cancelled: (cur.STATUS?.value ?? '').toUpperCase() === 'CANCELLED',
          allDay: false,
        });
      }
      cur = null;
      continue;
    }
    if (!cur) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const head = line.slice(0, idx);
    const [name = '', ...params] = head.split(';');
    cur[name.toUpperCase()] = { value: line.slice(idx + 1), params: params.join(';').toUpperCase() };
  }
  return { events, skipped };
}

function addMinutesHHmm(t: HHmm, min: number): HHmm {
  const [h, m] = t.split(':').map(Number) as [number, number];
  const total = (h * 60 + m + min) % 1440;
  return `${pad2(Math.floor(total / 60))}:${pad2(total % 60)}`;
}

export type IcsMergeAction =
  | { kind: 'create'; event: IcsEvent }
  | { kind: 'update'; event: IcsEvent; activityId: string }
  | { kind: 'skip'; event: IcsEvent; activityId: string; reason: string };

/**
 * Piano di importazione deterministico: un evento con UID già presente non crea duplicati.
 * Le attività completate o cancellate non vengono mai modificate dall'importazione
 * (SkiWork resta la fonte di verità per i dati economici).
 */
export function planIcsImport(events: IcsEvent[], existing: Pick<Activity, 'id' | 'externalUid' | 'status'>[]): IcsMergeAction[] {
  const byUid = new Map<string, Pick<Activity, 'id' | 'externalUid' | 'status'>>();
  for (const a of existing) byUid.set(activityUid(a as Activity), a);
  const seen = new Set<string>();
  const out: IcsMergeAction[] = [];
  for (const ev of events) {
    if (seen.has(ev.uid)) continue; // duplicato nello stesso file
    seen.add(ev.uid);
    const ex = byUid.get(ev.uid);
    if (!ex) out.push({ kind: 'create', event: ev });
    else if (ex.status === 'completed' || ex.status === 'cancelled') out.push({ kind: 'skip', event: ev, activityId: ex.id, reason: 'Attività già completata o cancellata' });
    else out.push({ kind: 'update', event: ev, activityId: ex.id });
  }
  return out;
}
