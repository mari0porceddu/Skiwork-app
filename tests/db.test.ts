import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { SkiWorkDB, useDatabase, db } from '../src/db/db';
import { createActivitySeries, deleteActivity, ensureSeed, importIcsEvents, ReasonRequiredError, saveActivity, saveRecord } from '../src/db/repo';
import { exportBackup, parseBackupText, restoreBackup } from '../src/db/backup';
import { parseIcs, exportIcs } from '../src/domain/ics';
import { computeActivity } from '../src/domain/compensation';
import { activity, client } from './fixtures';

let n = 0;
beforeEach(async () => {
  useDatabase(new SkiWorkDB(`test-${n++}`));
  await db.open();
});

describe('persistenza', () => {
  it('i dati salvati restano disponibili dopo la riapertura del database', async () => {
    const name = db.name;
    await saveRecord('clients', client());
    await saveActivity(activity());
    db.close();
    const reopened = new SkiWorkDB(name);
    await reopened.open();
    expect(await reopened.activities.count()).toBe(1);
    expect(computeActivity((await reopened.activities.get('a1'))!).accruedCents).toBe(10000);
    reopened.close();
  });

  it('i dati iniziali contengono solo i committenti dichiarati e vengono creati una volta', async () => {
    await ensureSeed();
    await ensureSeed();
    const clients = await db.clients.toArray();
    expect(clients.map((c) => c.name).sort()).toEqual(['Associazione sportiva', 'Scuola di sci']);
    expect(await db.rates.count()).toBe(0);
  });
});

describe('storico e tracciabilità', () => {
  it('modificare i dati economici di un’attività completata richiede una motivazione e viene registrato', async () => {
    await saveActivity(activity());
    const changed = { ...activity(), end: '12:00' };
    await expect(saveActivity(changed)).rejects.toBeInstanceOf(ReasonRequiredError);
    await saveActivity(changed, 'Lezione prolungata');
    const log = await db.audit.where('entityId').equals('a1').toArray();
    const upd = log.find((l) => l.action === 'update')!;
    expect(upd.reason).toBe('Lezione prolungata');
    expect(upd.changes.end).toEqual({ from: '11:00', to: '12:00' });
  });

  it('le modifiche non economiche non richiedono motivazione', async () => {
    await saveActivity(activity());
    await saveActivity({ ...activity(), notes: 'ok' });
    expect((await db.activities.get('a1'))!.notes).toBe('ok');
  });

  it('completare più volte la stessa attività non duplica il compenso', async () => {
    await saveActivity(activity({ status: 'confirmed' }));
    await saveActivity(activity({ status: 'completed' }));
    await saveActivity(activity({ status: 'completed' }));
    const all = await db.activities.toArray();
    expect(all).toHaveLength(1);
    expect(all.reduce((s, a) => s + computeActivity(a).accruedCents, 0)).toBe(10000);
  });

  it('eliminare un’attività completata richiede una motivazione', async () => {
    await saveActivity(activity());
    await expect(deleteActivity('a1')).rejects.toBeInstanceOf(ReasonRequiredError);
    await deleteActivity('a1', 'Inserita per errore');
    expect(await db.activities.count()).toBe(0);
  });

  it('crea serie ricorrenti', async () => {
    const items = await createActivitySeries(activity({ status: 'planned' }), ['2026-01-10', '2026-01-17']);
    expect(items).toHaveLength(2);
    expect(new Set(items.map((i) => i.seriesId)).size).toBe(1);
    expect(await db.activities.where('seriesId').equals(items[0]!.seriesId!).count()).toBe(2);
  });
});

describe('importazione ICS', () => {
  it('importare più volte lo stesso file non genera duplicati', async () => {
    const ics = exportIcs([activity({ id: 'ext', status: 'confirmed' })], new Map());
    const { events } = parseIcs(ics);
    const r1 = await importIcsEvents(events);
    const r2 = await importIcsEvents(events);
    expect(r1.created).toBe(1);
    expect(r2.created).toBe(0);
    expect(await db.activities.count()).toBe(1);
  });
});

describe('backup e ripristino', () => {
  it('esporta e ripristina tutti i dati', async () => {
    await ensureSeed();
    const c = (await db.clients.toArray())[0]!;
    await saveActivity(activity({ clientId: c.id }));
    const backup = await exportBackup();
    const text = JSON.stringify(backup);
    const v = parseBackupText(text);
    expect(v.ok).toBe(true);

    await db.activities.clear();
    await restoreBackup(v.data!);
    expect(await db.activities.count()).toBe(1);
    expect(await db.clients.count()).toBe(2);
  });

  it('un file non valido non modifica i dati', async () => {
    await saveRecord('clients', client());
    expect(parseBackupText('{nope').ok).toBe(false);
    expect(parseBackupText(JSON.stringify({ app: 'skiwork' })).ok).toBe(false);
    expect(await db.clients.count()).toBe(1);
  });
});

describe('migrazioni', () => {
  it('un database creato con la versione 1 viene aggiornato senza perdere dati', async () => {
    const { default: Dexie } = await import('dexie');
    const name = `migr-${Date.now()}`;
    const v1 = new Dexie(name);
    v1.version(1).stores({ clients: 'id, name, kind, active', rates: 'id, clientId, activityType, validFrom', activities: 'id, date, clientId, status, type, seriesId, &externalUid', availability: 'id, kind, date', ledger: 'id, kind, date, clientId, activityId', documents: 'id, clientId, issueDate, dueDate, status', payments: 'id, documentId, clientId, date', goals: 'id, metric', audit: 'id, entity, entityId, at', settings: 'key', files: 'id' });
    await v1.open();
    await v1.table('activities').add(activity());
    v1.close();
    const v2 = new SkiWorkDB(name);
    await v2.open();
    expect(v2.verno).toBe(2);
    expect(await v2.activities.count()).toBe(1);
    expect(await v2.fiscalParams.count()).toBe(0);
    v2.close();
  });
});
