import { describe, expect, it } from 'vitest';
import { computeDayAvailability, detectConflicts, expandWeekly, formatInterval, rulesForDate } from '../src/domain/schedule';
import { parseIcs, exportIcs, planIcsImport } from '../src/domain/ics';
import { addDays, endOfMonth, spanMinutes, startOfWeek, weekday } from '../src/domain/time';
import { activity, avail, client } from './fixtures';

describe('date e orari', () => {
  it('cambi di giorno, mese e anno', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(endOfMonth('2026-02-10')).toBe('2026-02-28');
    expect(weekday('2026-10-13')).toBe(1); // martedì
    expect(startOfWeek('2026-10-18')).toBe('2026-10-12');
    expect(spanMinutes('23:30', '00:30')).toBe(60);
    expect(spanMinutes('10:00', '10:00')).toBe(0);
  });
});

describe('conflitti', () => {
  it('gli eventi sovrapposti vengono segnalati', () => {
    const c = detectConflicts([activity({ id: 'a', start: '09:00', end: '11:00' }), activity({ id: 'b', start: '10:30', end: '12:00' })]);
    expect(c).toEqual([{ aId: 'a', bId: 'b', kind: 'overlap', minutes: 30 }]);
  });

  it('gli eventi cancellati non generano conflitti (liberano lo slot)', () => {
    const c = detectConflicts([activity({ id: 'a' }), activity({ id: 'b', status: 'cancelled' })]);
    expect(c).toEqual([]);
  });

  it('eventi adiacenti nello stesso luogo non sono in conflitto; con trasferimento sì', () => {
    const clients = new Map([
      ['school', client({ travelMinutes: 0 })],
      ['asd', client({ id: 'asd', travelMinutes: 30 })],
    ]);
    const a = activity({ id: 'a', start: '09:00', end: '11:00', location: 'Champoluc' });
    expect(detectConflicts([a, activity({ id: 'b', start: '11:00', end: '12:00', location: 'Champoluc' })], clients)).toEqual([]);
    const c = detectConflicts([a, activity({ id: 'b', clientId: 'asd', start: '11:15', end: '12:00', location: 'Gressoney' })], clients);
    expect(c).toEqual([{ aId: 'a', bId: 'b', kind: 'travel', minutes: 15 }]);
  });

  it('conflitti tra giorni diversi (attività oltre la mezzanotte)', () => {
    const c = detectConflicts([activity({ id: 'a', date: '2026-01-10', start: '23:00', end: '02:00' }), activity({ id: 'b', date: '2026-01-11', start: '01:00', end: '03:00' })]);
    expect(c[0]?.kind).toBe('overlap');
    expect(c[0]?.minutes).toBe(60);
  });
});

describe('ricorrenze', () => {
  it('espande le occorrenze settimanali', () => {
    // martedì e giovedì dal 13 al 22 ottobre 2026
    expect(expandWeekly('2026-10-13', '2026-10-22', [1, 3])).toEqual(['2026-10-13', '2026-10-15', '2026-10-20', '2026-10-22']);
    expect(expandWeekly('2026-10-13', '2026-10-01', [1])).toEqual([]);
  });
});

describe('disponibilità', () => {
  const date = '2026-01-10';

  it('le disponibilità rispettano le fasce configurate', () => {
    const r = computeDayAvailability(date, [avail({ start: '09:00', end: '16:00' }), avail({ id: 'u', kind: 'unavailable', start: '12:00', end: '13:00' })], []);
    expect(r.available.map(formatInterval)).toEqual(['09:00–12:00', '13:00–16:00']);
    expect(r.freeSlots.map(formatInterval)).toEqual(['09:00–12:00', '13:00–16:00']);
  });

  it('gli impegni confermati occupano lo slot, i cancellati lo liberano', () => {
    const rules = [avail({ start: '09:00', end: '17:00' })];
    const busy = computeDayAvailability(date, rules, [activity({ start: '10:00', end: '12:00', status: 'confirmed' })]);
    expect(busy.freeSlots.map(formatInterval)).toEqual(['09:00–10:00', '12:00–17:00']);
    const freed = computeDayAvailability(date, rules, [activity({ start: '10:00', end: '12:00', status: 'cancelled' })]);
    expect(freed.freeSlots.map(formatInterval)).toEqual(['09:00–17:00']);
  });

  it('distingue proposte non confermate, tempo non occupato e disponibilità', () => {
    const r = computeDayAvailability(date, [avail({ start: '09:00', end: '17:00' })], [activity({ start: '14:00', end: '15:00', status: 'planned' })]);
    expect(r.tentative.map(formatInterval)).toEqual(['14:00–15:00']);
    expect(r.busy).toEqual([]);
    expect(r.unoccupied.map(formatInterval)).toEqual(['00:00–14:00', '15:00–24:00']);
    expect(r.freeSlots.map(formatInterval)).toEqual(['09:00–14:00', '15:00–17:00']);
  });

  it('considera i tempi di trasferimento e la durata minima dello slot', () => {
    const clients = new Map([['school', client({ travelMinutes: 30 })]]);
    const r = computeDayAvailability(date, [avail({ start: '09:00', end: '17:00' })], [activity({ start: '10:00', end: '12:00', status: 'confirmed' })], { clients, minSlotMinutes: 60 });
    expect(r.freeSlots.map(formatInterval)).toEqual(['12:30–17:00']);
  });

  it('le fasce "accetto lezioni" limitano gli slot prenotabili', () => {
    const r = computeDayAvailability(date, [avail({ start: '08:00', end: '18:00' }), avail({ id: 'b', kind: 'bookable', start: '13:00', end: '16:00' })], []);
    expect(r.freeSlots.map(formatInterval)).toEqual(['13:00–16:00']);
  });

  it('le eccezioni per data sostituiscono le regole ricorrenti', () => {
    const rules = [avail({ start: '09:00', end: '17:00' }), avail({ id: 'ex', date, weekdays: [], kind: 'unavailable', start: '00:00', end: '00:00' })];
    expect(rulesForDate(rules, date).map((r) => r.id)).toEqual(['ex']);
    expect(computeDayAvailability(date, rules, []).freeSlots).toEqual([]);
    expect(rulesForDate(rules, '2026-01-11').map((r) => r.id)).toEqual(['av1']);
  });

  it('regole ricorrenti per giorno della settimana e validità', () => {
    const rules = [avail({ weekdays: [5], validFrom: '2026-01-01', validTo: '2026-01-31' })];
    expect(rulesForDate(rules, '2026-01-10')).toHaveLength(1); // sabato
    expect(rulesForDate(rules, '2026-01-11')).toHaveLength(0); // domenica
    expect(rulesForDate(rules, '2026-02-07')).toHaveLength(0); // fuori validità
  });

  it('impegni oltre la mezzanotte occupano anche il giorno successivo', () => {
    const r = computeDayAvailability('2026-01-11', [avail({ start: '00:00', end: '06:00' })], [activity({ date: '2026-01-10', start: '22:00', end: '02:00', status: 'confirmed' })]);
    expect(r.freeSlots.map(formatInterval)).toEqual(['02:00–06:00']);
  });
});

describe('ICS', () => {
  it('gli eventi importati più volte non generano duplicati', () => {
    const ics = exportIcs([activity({ id: 'a1', title: 'Lezione, Rossi; 2', location: 'Pista 3' })], new Map([['school', 'Scuola']]));
    const parsed = parseIcs(ics);
    expect(parsed.events).toHaveLength(1);
    expect(parsed.events[0]).toMatchObject({ uid: 'a1@skiwork', title: 'Lezione, Rossi; 2', date: '2026-01-10', start: '09:00', end: '11:00', location: 'Pista 3' });

    const first = planIcsImport(parsed.events, []);
    expect(first.map((x) => x.kind)).toEqual(['create']);
    // dopo la prima importazione l'attività ha externalUid = uid
    const existing = [{ id: 'new', externalUid: 'a1@skiwork', status: 'planned' as const }];
    expect(planIcsImport(parsed.events, existing).map((x) => x.kind)).toEqual(['update']);
    // stesso evento ripetuto nel file
    expect(planIcsImport([...parsed.events, ...parsed.events], [])).toHaveLength(1);
    // un'attività completata non viene modificata
    expect(planIcsImport(parsed.events, [{ id: 'new', externalUid: 'a1@skiwork', status: 'completed' }])[0]?.kind).toBe('skip');
  });

  it('esporta correttamente le attività oltre la mezzanotte e interpreta UTC', () => {
    const ics = exportIcs([activity({ start: '22:00', end: '01:00' })], new Map(), new Date('2026-01-01T00:00:00Z'));
    expect(ics).toContain('DTSTART:20260110T220000');
    expect(ics).toContain('DTEND:20260111T010000');
    const p = parseIcs('BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:x\r\nDTSTART;VALUE=DATE:20260110\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:y\r\nDTSTART:20260110T090000\r\nDTEND:20260110T100000\r\nSUMMARY:Pro\r\n va\r\nEND:VEVENT\r\nEND:VCALENDAR');
    expect(p.skipped.map((s) => s.uid)).toEqual(['x']);
    expect(p.events[0]?.title).toBe('Prova');
  });
});
