/**
 * Sincronizzazione nei due sensi con il calendario Google "SkiWork", creato dall'app.
 * Invio: attività modificate dopo l'ultimo invio → evento creato/aggiornato; cancellate o eliminate → evento rimosso.
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

/** Id del calendario "SkiWork": quello salvato se esiste ancora, altrimenti ne crea uno nuovo. */
export async function ensureCalendar(token: string): Promise<string> {
  const saved = await getSetting<string | null>('calendarId', null);
  if (saved) {
    try {
      await api(token, `${BASE}/calendars/${encodeURIComponent(saved)}`);
      return saved;
    } catch (e) {
      if (!(e instanceof GoogleApiError) || (e.status !== 404 && e.status !== 410)) throw e;
    }
  }
  const r = await api(token, `${BASE}/calendars`, { method: 'POST', ...json({ summary: 'SkiWork', description: 'Lezioni e allenamenti sincronizzati con SkiWork', timeZone: tz() }) });
  const id = ((await r.json()) as { id: string }).id;
  await setSetting('calendarId', id);
  await setSetting('calendarSyncToken', null);
  await db.activities.toCollection().modify((a: Activity) => {
    delete a.gcalEventId;
    delete a.gcalSyncedAt;
    delete a.gcalUpdated;
  });
  return id;
}

/** Aggiorna solo i metadati di sincronizzazione, senza toccare updatedAt né il registro modifiche. */
async function markSynced(id: string, patch: Partial<Activity>): Promise<void> {
  await db.activities.update(id, patch);
}

async function push(token: string, cal: string): Promise<number> {
  const calUrl = `${BASE}/calendars/${encodeURIComponent(cal)}/events`;
  let n = 0;
  const pendingDeletes = await getSetting<string[]>('gcalPendingDeletes', []);
  for (const eventId of pendingDeletes) {
    try {
      await api(token, `${calUrl}/${encodeURIComponent(eventId)}`, { method: 'DELETE' });
    } catch (e) {
      if (!(e instanceof GoogleApiError) || (e.status !== 404 && e.status !== 410)) throw e;
    }
    n++;
  }
  if (pendingDeletes.length) await setSetting('gcalPendingDeletes', []);

  const clients = new Map((await db.clients.toArray()).map((c) => [c.id, c.name]));
  for (const a of await db.activities.toArray()) {
    if (!needsPush(a)) continue;
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
export async function syncCalendar(token: string): Promise<CalendarReport> {
  const cal = await ensureCalendar(token);
  const { created, updated } = await pull(token, cal);
  const sent = await push(token, cal);
  await setSetting('calendarLastSyncAt', new Date().toISOString());
  return { sent, created, updated };
}
