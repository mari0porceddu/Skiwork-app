import { describe, expect, it } from 'vitest';
import { activityToEvent, eventSlots, needsPush, planPull, type GEvent } from '../src/domain/gcal';
import { activity } from './fixtures';

describe('Google Calendar: regole', () => {
  it('evento da attività: orari locali, titolo con committente, id SkiWork', () => {
    const ev = activityToEvent(activity({ id: 'a1', title: 'Allenamento', date: '2026-12-05', start: '23:00', end: '01:00', shift: 'afternoon', level: 'beginner', notes: 'n' }), 'Club', 'Europe/Rome');
    expect(ev).toMatchObject({
      summary: 'Allenamento · Club',
      start: { dateTime: '2026-12-05T23:00:00', timeZone: 'Europe/Rome' },
      end: { dateTime: '2026-12-06T01:00:00' },
      description: 'Pomeriggio · Principiante\n\nn',
      extendedProperties: { private: { skiworkId: 'a1' } },
    });
  });

  it('eventi tutto il giorno su più date diventano più giorni (fine esclusa)', () => {
    expect(eventSlots({ id: 'e', start: { date: '2026-11-28' }, end: { date: '2026-11-30' } }).map((s) => s.date)).toEqual(['2026-11-28', '2026-11-29']);
  });

  it('invio necessario solo se modificata dopo l’ultimo invio', () => {
    expect(needsPush(activity({ updatedAt: 'x' }))).toBe(true);
    expect(needsPush(activity({ updatedAt: 'x', gcalSyncedAt: 'x' }))).toBe(false);
  });

  const linked = activity({ id: 'a1', gcalEventId: 'e1', gcalSyncedAt: 'u', updatedAt: 'u', gcalUpdated: '2026-10-01T00:00:00Z', date: '2026-12-05', start: '09:00', end: '12:00', location: '', status: 'planned' });
  const timed = (p: Partial<GEvent>): GEvent => ({ id: 'e1', updated: '2026-10-02T00:00:00Z', start: { date: '2026-12-06' }, end: { date: '2026-12-07' }, ...p });

  it('nuovo evento creato su Google → nuova attività; eventi eliminati o nati da SkiWork ignorati', () => {
    const acts = planPull([
      { id: 'n1', summary: 'Lezione', start: { date: '2026-12-10' }, end: { date: '2026-12-11' } },
      { id: 'n2', status: 'cancelled' },
      { id: 'n3', start: { date: '2026-12-10' }, end: { date: '2026-12-11' }, extendedProperties: { private: { skiworkId: 'deleted' } } },
    ], []);
    expect(acts.map((a) => a.kind)).toEqual(['create']);
  });

  it('evento collegato spostato su Google → aggiorna data e orari', () => {
    const [a] = planPull([timed({ location: 'Gressoney' })], [linked]);
    expect(a).toMatchObject({ kind: 'update', changes: { date: '2026-12-06', end: '16:00', location: 'Gressoney' } });
  });

  it('il proprio invio non torna indietro; eliminato su Google → cancellata se pianificata', () => {
    expect(planPull([timed({ updated: '2026-10-01T00:00:00Z' })], [linked])).toEqual([]);
    expect(planPull([timed({ status: 'cancelled' })], [linked])[0]?.kind).toBe('cancel');
    expect(planPull([timed({ status: 'cancelled' })], [{ ...linked, status: 'completed' }])[0]?.kind).toBe('seen');
  });

  it('modificata anche in SkiWork dopo l’ultimo invio: vince SkiWork', () => {
    expect(planPull([timed({})], [{ ...linked, updatedAt: 'later' }])[0]?.kind).toBe('seen');
  });
});
