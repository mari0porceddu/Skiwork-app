/**
 * Operazioni di scrittura con tracciamento delle modifiche.
 * Tutte le scritture passano da qui, così il registro modifiche è coerente.
 */
import { ECONOMIC_FIELDS } from '../domain/compensation';
import { newId } from '../domain/ids';
import { planIcsImport, type IcsEvent } from '../domain/ics';
import { planShiftRealign } from '../domain/shifts';
import type { Activity, AuditEntry, Client, ID } from '../domain/types';
import { db } from './db';

const nowIso = () => new Date().toISOString();

type Table = 'clients' | 'rates' | 'availability' | 'ledger' | 'documents' | 'payments' | 'goals' | 'fiscalParams' | 'fiscalDeadlines';

function diff(before: object | undefined, after: object, fields?: readonly string[]): AuditEntry['changes'] {
  const changes: AuditEntry['changes'] = {};
  const keys = fields ?? Object.keys(after).filter((k) => k !== 'updatedAt' && k !== 'createdAt');
  for (const k of keys) {
    const from = before ? (before as Record<string, unknown>)[k] : undefined;
    const to = (after as Record<string, unknown>)[k];
    if (JSON.stringify(from) !== JSON.stringify(to)) changes[k] = { from, to };
  }
  return changes;
}

async function audit(entity: string, entityId: ID, action: AuditEntry['action'], changes: AuditEntry['changes'], reason = ''): Promise<void> {
  await db.audit.add({ id: newId(), entity, entityId, action, changes, reason, at: nowIso() });
}

/** Salva (crea o aggiorna) un record generico registrando la modifica. */
export async function saveRecord<T extends { id: ID; createdAt: string; updatedAt: string }>(table: Table, record: T, reason = ''): Promise<T> {
  const t = db.table(table);
  return db.transaction('rw', t, db.audit, async () => {
    const before = (await t.get(record.id)) as T | undefined;
    const stamp = nowIso();
    const next = { ...record, createdAt: before?.createdAt ?? stamp, updatedAt: stamp };
    await t.put(next);
    const changes = diff(before, next);
    if (!before || Object.keys(changes).length > 0) await audit(table, record.id, before ? 'update' : 'create', changes, reason);
    return next;
  });
}

export async function deleteRecord(table: Table, id: ID, reason = ''): Promise<void> {
  const t = db.table(table);
  await db.transaction('rw', t, db.audit, async () => {
    const before = await t.get(id);
    if (!before) return;
    await t.delete(id);
    await audit(table, id, 'delete', diff(before, {}, Object.keys(before)), reason);
  });
}

export class ReasonRequiredError extends Error {
  constructor() {
    super('Per modificare i dati economici di un’attività completata serve una motivazione.');
  }
}

/** true se la modifica tocca campi economici di un'attività già completata. */
export function needsReason(before: Activity | undefined, next: Activity): boolean {
  if (!before || before.status !== 'completed') return false;
  return Object.keys(diff(before, next, ECONOMIC_FIELDS)).length > 0;
}

export async function saveActivity(activity: Activity, reason = ''): Promise<Activity> {
  return db.transaction('rw', db.activities, db.audit, async () => {
    const before = await db.activities.get(activity.id);
    if (needsReason(before, activity) && reason.trim() === '') throw new ReasonRequiredError();
    const stamp = nowIso();
    const next: Activity = { ...activity, createdAt: before?.createdAt ?? stamp, updatedAt: stamp };
    if (next.externalUid === undefined || next.externalUid === '') delete next.externalUid;
    if (next.seriesId === undefined) delete next.seriesId;
    if (next.shift === undefined) delete next.shift;
    if (next.level === undefined) delete next.level;
    if (!next.needsDetails) delete next.needsDetails;
    await db.activities.put(next);
    const changes = diff(before, next);
    if (!before) await audit('activities', next.id, 'create', changes, reason);
    else if (Object.keys(changes).length > 0) await audit('activities', next.id, changes.status && Object.keys(changes).length === 1 ? 'status' : 'update', changes, reason);
    return next;
  });
}

/**
 * Salva il committente e riallinea agli orari dei turni le sue attività pianificate o confermate.
 * Restituisce il numero di attività aggiornate.
 */
export async function saveClientAndRealignShifts(client: Client): Promise<number> {
  return db.transaction('rw', db.clients, db.activities, db.audit, async () => {
    const saved = await saveRecord('clients', client);
    const changed = planShiftRealign(saved, await db.activities.where('clientId').equals(client.id).toArray());
    for (const a of changed) await saveActivity(a, 'Orari del turno aggiornati');
    return changed.length;
  });
}

export async function createActivitySeries(template: Activity, dates: string[]): Promise<Activity[]> {
  const seriesId = newId();
  const stamp = nowIso();
  const items: Activity[] = dates.map((date) => ({ ...template, id: newId(), date, seriesId, createdAt: stamp, updatedAt: stamp }));
  await db.transaction('rw', db.activities, db.audit, async () => {
    await db.activities.bulkAdd(items);
    for (const a of items) await audit('activities', a.id, 'create', { seriesId: { from: undefined, to: seriesId }, date: { from: undefined, to: a.date } });
  });
  return items;
}

export async function deleteActivity(id: ID, reason = ''): Promise<void> {
  await db.transaction('rw', db.activities, db.audit, db.ledger, db.settings, async () => {
    const before = await db.activities.get(id);
    if (!before) return;
    if (before.status === 'completed' && reason.trim() === '') throw new ReasonRequiredError();
    await db.activities.delete(id);
    // l'evento collegato su Google Calendar verrà rimosso alla prossima sincronizzazione
    if (before.gcalEventId) {
      const pending = ((await db.settings.get('gcalPendingDeletes'))?.value as string[] | undefined) ?? [];
      await db.settings.put({ key: 'gcalPendingDeletes', value: [...pending, before.gcalEventId] });
    }
    // le voci collegate (rimborsi) restano ma perdono il collegamento
    await db.ledger.where('activityId').equals(id).modify({ activityId: null });
    await audit('activities', id, 'delete', diff(before, {}, Object.keys(before)), reason);
  });
}

export interface IcsImportReport {
  created: number;
  updated: number;
  skipped: { uid: string; reason: string }[];
}

export async function importIcsEvents(events: IcsEvent[]): Promise<IcsImportReport> {
  return db.transaction('rw', db.activities, db.audit, async () => {
    const existing = await db.activities.toArray();
    const plan = planIcsImport(events, existing);
    const report: IcsImportReport = { created: 0, updated: 0, skipped: [] };
    const stamp = nowIso();
    for (const step of plan) {
      const ev = step.event;
      if (step.kind === 'create') {
        const a: Activity = {
          id: newId(),
          title: ev.title,
          type: 'other',
          clientId: null,
          date: ev.date,
          start: ev.start,
          end: ev.end,
          breakMinutes: 0,
          actualMinutes: null,
          units: 1,
          status: ev.cancelled ? 'cancelled' : 'planned',
          location: ev.location,
          notes: ev.notes,
          rate: null,
          manualAdjustmentCents: 0,
          manualAdjustmentReason: '',
          cancellationFeeCents: 0,
          reminderMinutesBefore: null,
          externalUid: ev.uid,
          createdAt: stamp,
          updatedAt: stamp,
        };
        await db.activities.add(a);
        await audit('activities', a.id, 'import', { externalUid: { from: undefined, to: ev.uid } });
        report.created++;
      } else if (step.kind === 'update') {
        const before = (await db.activities.get(step.activityId))!;
        const next: Activity = { ...before, title: ev.title || before.title, date: ev.date, start: ev.start, end: ev.end, location: ev.location || before.location, status: ev.cancelled ? 'cancelled' : before.status, updatedAt: stamp };
        const changes = diff(before, next);
        if (Object.keys(changes).length > 0) {
          await db.activities.put(next);
          await audit('activities', next.id, 'import', changes);
          report.updated++;
        }
      } else {
        report.skipped.push({ uid: ev.uid, reason: step.reason });
      }
    }
    return report;
  });
}

// ---------------------------------------------------------------------------
// Impostazioni

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const s = await db.settings.get(key);
  return s === undefined ? fallback : (s.value as T);
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await db.settings.put({ key, value });
}

// ---------------------------------------------------------------------------
// Dati iniziali: solo i committenti dichiarati, nessuna tariffa o dato economico inventato.

export async function ensureSeed(): Promise<void> {
  await db.transaction('rw', db.clients, db.settings, db.audit, async () => {
    const seeded = await db.settings.get('seeded');
    if (seeded) return;
    const stamp = nowIso();
    const base: Omit<Client, 'id' | 'name' | 'kind' | 'color'> = {
      travelMinutes: 0,
      documentationMode: 'Fattura (partita IVA)',
      billingPeriodicity: 'Da configurare',
      paymentTermsDays: null,
      paymentMethod: '',
      adminNotes: '',
      notes: '',
      active: true,
      createdAt: stamp,
      updatedAt: stamp,
    };
    const school: Client = { ...base, id: newId(), name: 'Scuola di sci', kind: 'ski_school', color: '#2563eb' };
    const asd: Client = { ...base, id: newId(), name: 'Associazione sportiva', kind: 'asd', color: '#ea580c' };
    await db.clients.bulkAdd([school, asd]);
    await audit('clients', school.id, 'create', {});
    await audit('clients', asd.id, 'create', {});
    await db.settings.put({ key: 'seeded', value: true });
  });
}
