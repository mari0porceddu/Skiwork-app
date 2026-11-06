import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GEvent } from '../src/domain/gcal';

vi.mock('../src/config', () => ({ GOOGLE_CLIENT_ID: 'test-client' }));

/** Calendario Google finto in memoria, con syncToken incrementale. */
function fakeGoogle(calendars: { id: string; summary: string }[] = []) {
  const events = new Map<string, GEvent>();
  const deleted = new Set<string>();
  let clock = 0;
  let seq = 0;
  const changedAt = new Map<string, number>();
  const stamp = () => new Date(Date.UTC(2026, 9, 1, 0, 0, ++clock)).toISOString();
  const touch = (ev: GEvent) => {
    ev.updated = stamp();
    events.set(ev.id, ev);
    changedAt.set(ev.id, clock);
  };
  const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const ok = (o: unknown) => new Response(JSON.stringify(o));
    if (u.pathname === '/calendar/v3/calendars' && method === 'POST') {
      const id = calendars.some((c) => c.id === 'cal1') || deleted.has('cal1') ? `cal${calendars.length + deleted.size + 1}` : 'cal1';
      calendars.push({ id, summary: body.summary });
      return ok({ id });
    }
    if (u.pathname === '/calendar/v3/users/me/calendarList') return ok({ items: calendars });
    const le = /^\/calendar\/v3\/users\/me\/calendarList\/(.+)$/.exec(u.pathname);
    if (le) return calendars.some((c) => c.id === decodeURIComponent(le[1]!)) ? ok({ id: le[1] }) : new Response('', { status: 404 });
    const live = /^\/calendar\/v3\/calendars\/([^/]+)/.exec(u.pathname);
    if (live && deleted.has(decodeURIComponent(live[1]!))) return new Response('', { status: 404 });
    const cm = /^\/calendar\/v3\/calendars\/([^/]+)$/.exec(u.pathname);
    if (cm && method === 'PATCH') {
      const c = calendars.find((x) => x.id === decodeURIComponent(cm[1]!));
      if (c) Object.assign(c, body);
      return ok(c ?? {});
    }
    const cg = /^\/calendar\/v3\/calendars\/([^/]+)$/.exec(u.pathname);
    if (cg && method === 'GET') return ok({ id: cg[1] });
    const m = /\/calendars\/[^/]+\/events(?:\/(.+))?$/.exec(u.pathname);
    if (!m) return new Response('', { status: 404 });
    const id = m[1] ? decodeURIComponent(m[1]) : undefined;
    if (!id && method === 'POST') {
      const ev = { ...body, id: `g${++seq}`, status: 'confirmed' };
      touch(ev);
      return ok(ev);
    }
    if (id && method === 'PATCH') {
      if (!events.has(id)) return new Response('', { status: 404 });
      const ev = { ...events.get(id)!, ...body };
      touch(ev);
      return ok(ev);
    }
    if (id && method === 'DELETE') {
      const ev = events.get(id);
      if (ev) touch({ ...ev, status: 'cancelled' });
      return new Response(null, { status: 204 });
    }
    const since = Number(u.searchParams.get('syncToken') ?? '0');
    return ok({ items: [...events.values()].filter((e) => changedAt.get(e.id)! > since), nextSyncToken: String(clock) });
  });
  return {
    fetchFn,
    events,
    calendars,
    /** L'utente elimina un calendario da Google Calendar. */
    deleteCalendar(id: string) {
      deleted.add(id);
      calendars.splice(calendars.findIndex((c) => c.id === id), 1);
      events.clear();
    },
    /** Modifica fatta dall'utente direttamente in Google Calendar. */
    userEdit(ev: GEvent) {
      touch(ev);
    },
  };
}

let n = 0;
beforeEach(() => {
  const m = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) });
});

describe('sincronizzazione Google Calendar', () => {
  it('invia le attività, importa gli eventi nuovi da completare, segue spostamenti ed eliminazioni', async () => {
    const D = await import('../src/db/db');
    D.useDatabase(new D.SkiWorkDB(`cal-${n++}`));
    await D.db.open();
    const { saveActivity, saveRecord, deleteActivity } = await import('../src/db/repo');
    const { syncCalendar } = await import('../src/sync/calendar');
    const { activity, client } = await import('./fixtures');
    const g = fakeGoogle();
    vi.stubGlobal('fetch', g.fetchFn);

    await saveRecord('clients', client({ id: 'c', name: 'Club' }));
    await saveActivity(activity({ id: 'a1', clientId: 'c', title: 'Allenamento', date: '2026-12-05', start: '14:00', end: '16:30', status: 'planned' }));

    // 1) invio
    expect(await syncCalendar('t')).toMatchObject({ sent: 1, created: 0 });
    const [sent] = [...g.events.values()];
    expect(sent).toMatchObject({ summary: 'Allenamento · Club', start: { dateTime: '2026-12-05T14:00:00' } });
    const a1 = (await D.db.activities.get('a1'))!;
    expect(a1.gcalEventId).toBe(sent!.id);

    // 2) nessun rimbalzo: una seconda sincronizzazione non cambia nulla
    expect(await syncCalendar('t')).toEqual({ sent: 0, created: 0, updated: 0 });

    // 3) evento aggiunto su Google → attività da completare
    g.userEdit({ id: 'u1', status: 'confirmed', summary: 'Privata famiglia R.', start: { date: '2026-12-08' }, end: { date: '2026-12-09' } });
    expect(await syncCalendar('t')).toMatchObject({ created: 1, sent: 0 });
    const imported = (await D.db.activities.toArray()).find((a) => a.gcalEventId === 'u1')!;
    expect(imported).toMatchObject({ title: 'Privata famiglia R.', date: '2026-12-08', needsDetails: true, clientId: null, status: 'planned' });

    // 4) completata nell'app → reinviata a Google con i dettagli
    await saveActivity({ ...imported, type: 'private_lesson', clientId: 'c', needsDetails: undefined });
    expect((await syncCalendar('t')).sent).toBe(1);
    expect(g.events.get('u1')?.summary).toBe('Privata famiglia R. · Club');

    // 5) spostato su Google → aggiornato in SkiWork
    g.userEdit({ ...g.events.get(sent!.id)!, start: { dateTime: '2026-12-06T14:00:00' }, end: { dateTime: '2026-12-06T17:00:00' } });
    expect((await syncCalendar('t')).updated).toBe(1);
    expect(await D.db.activities.get('a1')).toMatchObject({ date: '2026-12-06', start: '14:00', end: '17:00' });

    // 6) eliminata in SkiWork → evento rimosso su Google, senza reimportarlo
    await deleteActivity('a1');
    await syncCalendar('t');
    expect(g.events.get(sent!.id)?.status).toBe('cancelled');
    expect(await syncCalendar('t')).toEqual({ sent: 0, created: 0, updated: 0 });
    expect(await D.db.activities.count()).toBe(1);
  });

  it('riusa il calendario SkiWork già esistente, rinomina i doppioni e non pubblica le attività cancellate', async () => {
    const D = await import('../src/db/db');
    D.useDatabase(new D.SkiWorkDB(`cal-${n++}`));
    await D.db.open();
    const { saveActivity } = await import('../src/db/repo');
    const { syncCalendar } = await import('../src/sync/calendar');
    const { activity } = await import('./fixtures');
    // Su Google c'è già il calendario dell'app (es. creato da un'altra sincronizzazione) con l'evento di a1, più un doppione.
    const g = fakeGoogle([{ id: 'zz-doppione', summary: 'SkiWork' }, { id: 'cal1', summary: 'SkiWork' }]);
    vi.stubGlobal('fetch', g.fetchFn);
    await saveActivity(activity({ id: 'a1', title: 'Allenamento', date: '2026-12-05', start: '08:45', end: '12:45', status: 'planned' }));
    await saveActivity(activity({ id: 'a2', title: 'Vecchia bozza', date: '2027-01-02', status: 'cancelled' }));
    g.userEdit({ id: 'old1', status: 'confirmed', summary: 'Allenamento', start: { dateTime: '2026-12-05T09:00:00' }, end: { dateTime: '2026-12-05T12:00:00' }, extendedProperties: { private: { skiworkId: 'a1' } } });
    g.userEdit({ id: 'old2', status: 'confirmed', summary: 'Allenamento', start: { dateTime: '2026-12-05T09:00:00' }, end: { dateTime: '2026-12-05T12:00:00' }, extendedProperties: { private: { skiworkId: 'a1' } } });

    // Due sincronizzazioni contemporanee (automatica + "Sincronizza ora") non creano un secondo calendario.
    await Promise.all([syncCalendar('t'), syncCalendar('t')]);
    const posts = g.fetchFn.mock.calls.filter(([url, init]) => String(url).endsWith('/calendar/v3/calendars') && init?.method === 'POST');
    expect(posts).toHaveLength(0);
    expect(g.calendars.find((c) => c.id === 'zz-doppione')?.summary).toBe('SkiWork (doppione, puoi eliminarlo)');
    expect(await D.db.settings.get('calendarId')).toMatchObject({ value: 'cal1' });

    // L'evento esistente viene ricollegato e riallineato agli orari di SkiWork; la copia in più eliminata.
    const live = [...g.events.values()].filter((e) => e.status !== 'cancelled');
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ start: { dateTime: '2026-12-05T08:45:00' } });
    expect((await D.db.activities.get('a1'))?.gcalEventId).toBe(live[0]!.id);
    // L'attività cancellata non è mai stata inviata.
    expect([...g.events.values()].some((e) => e.extendedProperties?.private?.skiworkId === 'a2')).toBe(false);
    expect(await syncCalendar('t')).toEqual({ sent: 0, created: 0, updated: 0 });

    // Cancellata dopo l'invio → l'evento sparisce da Google invece di restare come "Cancellato".
    await saveActivity({ ...(await D.db.activities.get('a1'))!, status: 'cancelled' });
    await syncCalendar('t');
    expect([...g.events.values()].filter((e) => e.status !== 'cancelled')).toHaveLength(0);
    expect(await syncCalendar('t')).toEqual({ sent: 0, created: 0, updated: 0 });
    expect((await D.db.activities.get('a1'))?.status).toBe('cancelled');
  });

  it('ricrea il calendario se è stato eliminato su Google e reinvia le attività', async () => {
    const D = await import('../src/db/db');
    D.useDatabase(new D.SkiWorkDB(`cal-${n++}`));
    await D.db.open();
    const { saveActivity } = await import('../src/db/repo');
    const { syncCalendar } = await import('../src/sync/calendar');
    const { activity } = await import('./fixtures');
    const g = fakeGoogle();
    vi.stubGlobal('fetch', g.fetchFn);
    await saveActivity(activity({ id: 'a1', title: 'Allenamento', date: '2026-12-05', status: 'planned' }));
    await syncCalendar('t');
    expect(await D.db.settings.get('calendarId')).toMatchObject({ value: 'cal1' });

    g.deleteCalendar('cal1');
    expect((await syncCalendar('t')).sent).toBe(1);
    const cal = (await D.db.settings.get('calendarId'))?.value;
    expect(cal).not.toBe('cal1');
    expect(g.calendars.map((c) => c.id)).toEqual([cal]);
    expect([...g.events.values()].filter((e) => e.extendedProperties?.private?.skiworkId === 'a1')).toHaveLength(1);
  });
});
