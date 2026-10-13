import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { SkiWorkDB, useDatabase, db } from '../src/db/db';
import { saveActivity, saveClientAndRealignShifts, saveRecord } from '../src/db/repo';
import { exportBackup, parseBackupText } from '../src/db/backup';
import { planShiftRealign, shiftTimes } from '../src/domain/shifts';
import { activity, client } from './fixtures';

let n = 0;
beforeEach(async () => {
  useDatabase(new SkiWorkDB(`shifts-${n++}`));
  await db.open();
});

describe('turni', () => {
  const shifts = { morning: { start: '09:00', end: '12:00' }, afternoon: { start: '14:00', end: '16:30' } };

  it('ignora turni non configurati o con orari non validi', () => {
    expect(shiftTimes({ shifts }, 'morning')).toEqual({ start: '09:00', end: '12:00' });
    expect(shiftTimes({ shifts }, 'full_day')).toBeNull();
    expect(shiftTimes({ shifts: { morning: { start: '09:00', end: '' } } }, 'morning')).toBeNull();
  });

  it('riallinea solo le attività pianificate o confermate del committente con quel turno', () => {
    const c = { id: 'asd', shifts: { morning: { start: '08:30', end: '12:30' } } };
    const list = [
      activity({ id: 'p', clientId: 'asd', status: 'planned', shift: 'morning', start: '09:00', end: '12:00' }),
      activity({ id: 'k', clientId: 'asd', status: 'confirmed', shift: 'morning', start: '09:00', end: '12:00' }),
      activity({ id: 'done', clientId: 'asd', status: 'completed', shift: 'morning', start: '09:00', end: '12:00' }),
      activity({ id: 'free', clientId: 'asd', status: 'planned', start: '09:00', end: '12:00' }),
      activity({ id: 'other', clientId: 'school', status: 'planned', shift: 'morning', start: '09:00', end: '12:00' }),
    ];
    const out = planShiftRealign(c, list);
    expect(out.map((a) => a.id)).toEqual(['p', 'k']);
    expect(out[0]).toMatchObject({ start: '08:30', end: '12:30' });
  });

  it('salvando il committente aggiorna le attività e i turni sopravvivono al backup', async () => {
    await saveRecord('clients', client({ id: 'asd', shifts }));
    await saveActivity(activity({ id: 'a', clientId: 'asd', status: 'planned', shift: 'afternoon', start: '14:00', end: '16:30' }));
    const c = (await db.clients.get('asd'))!;
    const moved = await saveClientAndRealignShifts({ ...c, shifts: { ...shifts, afternoon: { start: '13:30', end: '17:00' } } });
    expect(moved).toBe(1);
    expect(await db.activities.get('a')).toMatchObject({ start: '13:30', end: '17:00', shift: 'afternoon' });
    const v = parseBackupText(JSON.stringify(await exportBackup()));
    expect(v.ok).toBe(true);
    if (v.ok && v.data) {
      expect(v.data.tables.activities[0]?.shift).toBe('afternoon');
      expect(v.data.tables.clients[0]?.shifts?.afternoon).toEqual({ start: '13:30', end: '17:00' });
    }
  });
});
