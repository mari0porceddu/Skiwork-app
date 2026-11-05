import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { SkiWorkDB, useDatabase, db } from '../src/db/db';
import { ensureSeed, saveActivity, saveRecord } from '../src/db/repo';
import { exportBackup, mergeBackup, parseBackupText } from '../src/db/backup';
import { activity, client } from './fixtures';

let n = 0;
beforeEach(async () => {
  useDatabase(new SkiWorkDB(`merge-${n++}`));
  await db.open();
});

async function backupOf(fill: () => Promise<void>) {
  const name = db.name;
  useDatabase(new SkiWorkDB(`${name}-src`));
  await db.open();
  await fill();
  const b = await exportBackup();
  db.close();
  useDatabase(new SkiWorkDB(name));
  await db.open();
  const v = parseBackupText(JSON.stringify(b));
  if (!v.ok || !v.data) throw new Error(v.errors.join());
  return v.data;
}

describe('aggiungi dati da file', () => {
  it('aggiunge senza cancellare, unifica i committenti per nome e ignora i duplicati', async () => {
    await saveRecord('clients', client({ id: 'mine', name: 'Sci Club Esempio' }));
    await saveActivity(activity({ id: 'old', clientId: 'mine', date: '2026-11-01', title: 'Mia lezione' }));
    await saveActivity(activity({ id: 'dup-local', clientId: 'mine', date: '2026-12-05', start: '14:00', end: '16:30', type: 'training', title: 'Allenamento' }));

    const file = await backupOf(async () => {
      await saveRecord('clients', client({ id: 'theirs', name: 'sci club esempio ', shifts: { morning: { start: '09:00', end: '12:00' } } }));
      await saveRecord('clients', client({ id: 'new', name: 'Club nuovo' }));
      await saveActivity(activity({ id: 'n1', clientId: 'theirs', date: '2026-12-06', level: 'beginner', title: 'Allenamento' }));
      await saveActivity(activity({ id: 'n2', clientId: 'theirs', date: '2026-12-05', start: '14:00', end: '16:30', type: 'training', title: 'allenamento' }));
      await saveActivity(activity({ id: 'n3', clientId: 'new', date: '2026-12-07' }));
    });

    const r = await mergeBackup(file);
    expect(r).toMatchObject({ activities: 2, clients: 1, matchedClients: 1, skippedDuplicates: 1 });
    const all = await db.activities.toArray();
    expect(all.map((a) => a.id).sort()).toEqual(['dup-local', 'n1', 'n3', 'old']);
    expect((await db.activities.get('n1'))).toMatchObject({ clientId: 'mine', level: 'beginner' });
    expect((await db.clients.get('mine'))?.shifts?.morning).toEqual({ start: '09:00', end: '12:00' });
    expect(await db.clients.get('theirs')).toBeUndefined();

    // Reimportare lo stesso file non aggiunge nulla
    expect(await mergeBackup(file)).toMatchObject({ activities: 0, clients: 0 });
    expect(await db.activities.count()).toBe(4);
  });

  it('i committenti iniziali di due installazioni diverse non si duplicano', async () => {
    await ensureSeed();
    const file = await backupOf(async () => {
      await ensureSeed();
      const asd = (await db.clients.toArray()).find((c) => c.kind === 'asd')!;
      await saveActivity(activity({ id: 'x', clientId: asd.id }));
    });
    await mergeBackup(file);
    expect(await db.clients.count()).toBe(2);
    const asd = (await db.clients.toArray()).find((c) => c.kind === 'asd')!;
    expect((await db.activities.get('x'))?.clientId).toBe(asd.id);
  });

  it('aggiorna attività e committenti con lo stesso id se il file è più recente', async () => {
    await saveRecord('clients', client({ id: 'c', name: 'Sci Club Esempio', shifts: { morning: { start: '09:00', end: '12:00' } } }));
    await saveActivity(activity({ id: 'a1', clientId: 'c', date: '2026-12-05', start: '09:00', end: '12:00', shift: 'morning', status: 'planned' }));
    await saveActivity(activity({ id: 'a2', clientId: 'c', date: '2026-12-06', start: '09:00', end: '12:00', shift: 'morning', status: 'planned' }));
    await saveActivity(activity({ id: 'a3', clientId: 'c', date: '2026-12-07', title: 'Modificata a mano' }));
    await db.activities.update('a1', { gcalEventId: 'ev1', gcalSyncedAt: 'x' });

    const file = await backupOf(async () => {});
    const later = '2099-01-01T00:00:00.000Z';
    const local = await db.activities.toArray();
    file.tables.clients = [{ ...(await db.clients.get('c'))!, shifts: { morning: { start: '08:45', end: '12:45' } }, updatedAt: later }];
    file.tables.activities = [
      { ...local.find((a) => a.id === 'a1')!, gcalEventId: undefined, gcalSyncedAt: undefined, start: '08:45', end: '12:45', status: 'cancelled', updatedAt: later },
      { ...local.find((a) => a.id === 'a3')!, title: 'Vecchia', updatedAt: '2000-01-01T00:00:00.000Z' },
    ];
    file.tables.settings = [{ key: 'fiscalProfile', value: { 'Regime fiscale': { value: 'Esempio', status: 'to_verify' }, Note: { value: 'dal file', status: '' } } }];
    await db.settings.put({ key: 'fiscalProfile', value: { Note: { value: 'mia nota', status: '' } } });

    const r = await mergeBackup(file);
    expect(r.updated).toBe(3);
    expect(await db.activities.get('a1')).toMatchObject({ status: 'cancelled', start: '08:45', gcalEventId: 'ev1', gcalSyncedAt: 'x' });
    expect(await db.activities.get('a2')).toMatchObject({ start: '08:45', end: '12:45' });
    expect((await db.activities.get('a3'))?.title).toBe('Modificata a mano');
    expect((await db.clients.get('c'))?.shifts?.morning).toEqual({ start: '08:45', end: '12:45' });
    expect((await db.settings.get('fiscalProfile'))?.value).toEqual({ Note: { value: 'mia nota', status: '' }, 'Regime fiscale': { value: 'Esempio', status: 'to_verify' } });
    expect((await mergeBackup(file)).updated).toBe(0);
  });
});
