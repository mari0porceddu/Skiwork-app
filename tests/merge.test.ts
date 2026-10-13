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
});
