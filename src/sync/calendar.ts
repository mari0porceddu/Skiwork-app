/**
 * Sincronizzazione nei due sensi con il calendario Google "SkiWork", creato dall'app.
 * Invio: attività modificate dopo l'ultimo invio → evento creato/aggiornato; cancellate o eliminate → evento rimosso.
 * Un solo calendario: se quello salvato manca si riusa un calendario "SkiWork" già creato dall'app (anche da un
 * altro dispositivo) prima di crearne uno; gli eventuali doppioni vengono rinominati per poterli eliminare.
 * Ricezione: modifiche incrementali (syncToken) → attività aggiornate o nuove attività "da completare".
 */
import { db } from '../db/db';
import { saveActivity, setSetting } from '../db/repo';
import { activityToEvent, needsPush, planPull, type GEvent } from '../domain/gcal';
import { newId } from '../domain/ids';
import type { Activity } from '../domain/types';
import { api, GoogleApiError } from './drive';

const BASE = 'https://www.googleapis.com/calendar/v3';
const json = (body: unknown): RequestInit => ({ headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Rome';

async function getSetting<T>(key: string, fallback: T): Promise<T> {
  return ((await db.settings.get(key))?.value as T | undefined) ?? fallback;
}

const CALENDAR_NAME = 'SkiWork';
const DUPLICATE_NAME = 'SkiWork (doppione, puoi eliminarlo)';

const gone = (e: unknown) => e instanceof GoogleApiError && (e.status === 403 || e.status === 404 || e.status === 410);

/** Il calendario c'è ancora e non è stato eliminato dall'elenco dell'utente. */
async function calendarExists(token: string, id: string): Promise<boolean> {
  try {
    await api(token, `${BASE}/calendars/${encodeURIComponent(id)}`);
  } catch (e) {
    if (gone(e)) return false;
    throw e;
  }
  try {
    await api(token, `${BASE}/users/me/calendarList/${encodeURIComponent(id)}`);
  } catch (e) {
    if (e instanceof GoogleApiError && (e.status === 404 || e.status === 410)) return false;
  }
  return true;
}

/** Dimentica il calendario salvato: alla prossima sincronizzazione se ne crea (o ritrova) uno. */
export async function forgetCalendar(): Promise<void> {
  await setSetting('calendarId', null);
  await setSetting('calendarDedupDone', false);
}

/** Calendari "SkiWork" creati dall'app e visibili con questo accesso; [] se Google non permette di elencarli. */
async function appCalendars(token: string): Promise<string[]> {
  try {
    const r = (await (await api(token, `${BASE}/users/me/calendarList?minAccessRole=owner&maxResults=250`)).json()) as { items?: { id: string; summary?: string }[] };
    return (r.items ?? []).filter((c) => c.summary === CALENDAR_NAME).map((c) => c.id).sort();
  } catch (e) {
    if (e instanceof GoogleApiError && e.status === 403) return [];
    throw e;
  }
}

/** Rinomina i doppioni (senza eliminarli: potrebbero contenere eventi aggiunti a mano). */
async function markDuplicates(token: string, keep: string, all: string[]): Promise<void> {
  for (const id of all) {
    if (id === keep) continue;
    await api(token, `${BASE}/calendars/${encodeURIComponent(id)}`, { method: 'PATCH', ...json({ summary: DUPLICATE_NAME }) }).catch(() => undefined);
  }
}

async function useCalendar(id: string): Promise<string> {
  await setSetting('calendarId', id);
  await setSetting('calendarSyncToken', null);
  // I collegamenti agli eventi valgono solo per il calendario precedente; quelli del calendario ritrovato
  // vengono ricollegati alla prossima ricezione tramite l'id SkiWork salvato negli eventi.
  await db.activities.toCollection().modify((a: Activity) => {
    delete a.gcalEventId;
    delete a.gcalSyncedAt;
    delete a.gcalUpdated;
  });
  return id;
}

/** Id del calendario "SkiWork": quello salvato se esiste ancora, poi uno già creato dall'app, altrimenti uno nuovo. */
export async function ensureCalendar(token: string): Promise<string> {
  const saved = await getSetting<string | null>('calendarId', null);
  const savedOk = saved ? await calendarExists(token, saved) : false;
  if (savedOk && (await getSetting<boolean>('calendarDedupDone', false))) return saved!;
  const found = await appCalendars(token);
  const keep = savedOk ? saved! : found[0];
  await markDuplicates(token, keep ?? '', found);
  await setSetting('calendarDedupDone', true);
  if (savedOk) return saved!;
  if (keep) return useCalendar(keep);
  const r = await api(token, `${BASE}/calendars`, { method: 'POST', ...json({ summary: CALENDAR_NAME, description: 'Lezioni e allenamenti sincronizzati con SkiWork', timeZone: tz() }) });
  return useCalendar(((await r.json()) as { id: string }).id);
}

/** Aggiorna solo i metadati di sincronizzazione, senza toccare updatedAt né il registro modifiche. */
async function markSynced(id: string, patch: Partial<Activity>): Promise<void> {
  await db.activities.update(id, patch);
}

async function deleteEvent(token: string, calUrl: string, eventId: string): Promise<void> {
  try {
    await api(token, `${calUrl}/${encodeURIComponent(eventId)}`, { method: 'DELETE' });
  } catch (e) {
    if (!(e instanceof GoogleApiError) || (e.status !== 404 && e.status !== 410)) throw e;
  }
}

async function push(token: string, cal: string): Promise<number> {
  const calUrl = `${BASE}/calendars/${encodeURIComponent(cal)}/events`;
  let n = 0;
  const pendingDeletes = await getSetting<string[]>('gcalPendingDeletes', []);
  for (const eventId of pendingDeletes) {
    await deleteEvent(token, calUrl, eventId);
    n++;
  }
  if (pendingDeletes.length) await setSetting('gcalPendingDeletes', []);

  const clients = new Map((await db.clients.toArray()).map((c) => [c.id, c.name]));
  for (const a of await db.activities.toArray()) {
    if (!needsPush(a)) continue;
    if (a.status === 'cancelled') {
      // Le attività cancellate non compaiono su Google.
      if (a.gcalEventId) await deleteEvent(token, calUrl, a.gcalEventId);
      await markSynced(a.id, { gcalEventId: undefined, gcalSyncedAt: a.updatedAt, gcalUpdated: undefined });
      n++;
      continue;
    }
    const body = activityToEvent(a, a.clientId ? clients.get(a.clientId) : undefined, tz());
    let ev: GEvent;
    try {
      const r = a.gcalEventId
        ? await api(token, `${calUrl}/${encodeURIComponent(a.gcalEventId)}`, { method: 'PATCH', ...json({ ...body, status: 'confirmed' }) })
        : await api(token, calUrl, { method: 'POST', ...json(body) });
      ev = (await r.json()) as GEvent;
    } catch (e) {
      // Evento eliminato su Google nel frattempo: lo si ricrea.
      if (!(e instanceof GoogleApiError) || (e.status !== 404 && e.status !== 410) || !a.gcalEventId) throw e;
      ev = (await (await api(token, calUrl, { method: 'POST', ...json(body) })).json()) as GEvent;
    }
    await markSynced(a.id, { gcalEventId: ev.id, gcalSyncedAt: a.updatedAt, gcalUpdated: ev.updated });
    n++;
  }
  return n;
}

async function listChanges(token: string, cal: string): Promise<{ events: GEvent[]; nextSyncToken: string | null }> {
  const events: GEvent[] = [];
  let syncToken = await getSetting<string | null>('calendarSyncToken', null);
  let pageToken: string | undefined;
  for (;;) {
    const q = new URLSearchParams({ showDeleted: 'true', singleEvents: 'true', maxResults: '250' });
    if (syncToken) q.set('syncToken', syncToken);
    if (pageToken) q.set('pageToken', pageToken);
    let page: { items?: GEvent[]; nextPageToken?: string; nextSyncToken?: string };
    try {
      page = await (await api(token, `${BASE}/calendars/${encodeURIComponent(cal)}/events?${q}`)).json();
    } catch (e) {
      if (e instanceof GoogleApiError && e.status === 410 && syncToken) {
        // Token scaduto: si rilegge tutto il calendario.
        syncToken = null;
        pageToken = undefined;
        events.length = 0;
        continue;
      }
      throw e;
    }
    events.push(...(page.items ?? []));
    if (page.nextPageToken) pageToken = page.nextPageToken;
    else return { events, nextSyncToken: page.nextSyncToken ?? null };
  }
}

async function pull(token: string, cal: string): Promise<{ created: number; updated: number }> {
  const { events, nextSyncToken } = await listChanges(token, cal);
  const actions = planPull(events, await db.activities.toArray());
  let created = 0;
  let updated = 0;
  for (const act of actions) {
    const ev = act.event;
    if (act.kind === 'create') {
      for (const [i, slot] of act.slots.entries()) {
        const stamp = new Date().toISOString();
        const a = await saveActivity({
          id: newId(), title: ev.summary ?? '', type: 'other', clientId: null, date: slot.date, start: slot.start, end: slot.end,
          breakMinutes: 0, actualMinutes: null, units: 1, status: 'planned', location: ev.location ?? '', notes: ev.description ?? '',
          rate: null, manualAdjustmentCents: 0, manualAdjustmentReason: '', cancellationFeeCents: 0, reminderMinutesBefore: null,
          needsDetails: true, createdAt: stamp, updatedAt: stamp,
        });
        // Solo il primo giorno resta collegato all'evento; gli altri giorni di un evento su più giorni sono attività separate.
        await markSynced(a.id, i === 0 ? { gcalEventId: ev.id, gcalSyncedAt: a.updatedAt, gcalUpdated: ev.updated } : {});
        created++;
      }
    } else if (act.kind === 'update' || act.kind === 'cancel') {
      const next: Activity = act.kind === 'update' ? { ...act.activity, ...act.changes } : { ...act.activity, status: 'cancelled' };
      const saved = await saveActivity(next, 'Modificata su Google Calendar');
      await markSynced(saved.id, { gcalSyncedAt: saved.updatedAt, gcalUpdated: ev.updated, ...(act.kind === 'cancel' ? { gcalEventId: undefined } : {}) });
      updated++;
    } else if (act.kind === 'relink') {
      // SkiWork resta la versione valida: l'evento verrà riallineato dall'invio che segue.
      await markSynced(act.activity.id, { gcalEventId: ev.id, gcalSyncedAt: undefined, gcalUpdated: ev.updated });
    } else if (act.kind === 'duplicate') {
      await deleteEvent(token, `${BASE}/calendars/${encodeURIComponent(cal)}/events`, ev.id);
    } else {
      await markSynced(act.activity.id, { gcalUpdated: ev.updated });
    }
  }
  if (nextSyncToken) await setSetting('calendarSyncToken', nextSyncToken);
  return { created, updated };
}

export interface CalendarReport {
  sent: number;
  created: number;
  updated: number;
}

/** Prima riceve da Google (così le modifiche fatte lì non vengono sovrascritte), poi invia. */
export function syncCalendar(token: string): Promise<CalendarReport> {
  // Una sola sincronizzazione alla volta (anche tra schede): due in parallelo creavano calendari doppi.
  if (!running) {
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
    const job: Promise<CalendarReport> = locks ? (locks.request('skiwork-calendar-sync', () => runSync(token)) as unknown as Promise<CalendarReport>) : runSync(token);
    running = job.finally(() => (running = null));
  }
  return running;
}

let running: Promise<CalendarReport> | null = null;

async function runSync(token: string, retried = false): Promise<CalendarReport> {
  try {
    return await syncOnce(token);
  } catch (e) {
    // Calendario eliminato su Google mentre era salvato: se ne usa un altro (o uno nuovo) e si riprova una volta.
    if (retried || !(e instanceof GoogleApiError) || (e.status !== 404 && e.status !== 410)) throw e;
    await forgetCalendar();
    return runSync(token, true);
  }
}

async function syncOnce(token: string): Promise<CalendarReport> {
  const cal = await ensureCalendar(token);
  const { created, updated } = await pull(token, cal);
  const sent = await push(token, cal);
  await setSetting('calendarLastSyncAt', new Date().toISOString());
  return { sent, created, updated };
}
