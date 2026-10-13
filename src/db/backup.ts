import { BACKUP_APP, BACKUP_FORMAT_VERSION, validateBackup, type BackupFile, type ValidationResult } from '../domain/backup';
import { newId } from '../domain/ids';
import { planMerge } from '../domain/merge';
import type { StoredFile } from '../domain/types';
import { db, DB_VERSION } from './db';

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function fileToDataUrl(f: StoredFile): Promise<string> {
  const buf = new Uint8Array(await f.blob.arrayBuffer());
  return `data:${f.type || 'application/octet-stream'};base64,${bytesToBase64(buf)}`;
}

function dataUrlToBlob(dataUrl: string): Blob {
  const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(dataUrl);
  if (!m) throw new Error('Allegato non valido');
  const [, type = '', , data = ''] = m;
  return new Blob([base64ToBytes(data)], { type });
}

export async function exportBackup(): Promise<BackupFile> {
  return db.transaction('r', [db.clients, db.rates, db.activities, db.availability, db.ledger, db.documents, db.payments, db.goals, db.audit, db.settings, db.files, db.fiscalParams, db.fiscalDeadlines], async () => {
    const files = await db.files.toArray();
    return {
      app: BACKUP_APP,
      formatVersion: BACKUP_FORMAT_VERSION,
      dbVersion: DB_VERSION,
      exportedAt: new Date().toISOString(),
      tables: {
        clients: await db.clients.toArray(),
        rates: await db.rates.toArray(),
        activities: await db.activities.toArray(),
        availability: await db.availability.toArray(),
        ledger: await db.ledger.toArray(),
        documents: await db.documents.toArray(),
        payments: await db.payments.toArray(),
        goals: await db.goals.toArray(),
        audit: await db.audit.toArray(),
        settings: await db.settings.toArray(),
        fiscalParams: await db.fiscalParams.toArray(),
        fiscalDeadlines: await db.fiscalDeadlines.toArray(),
        files: await Promise.all(files.map(async (f) => ({ id: f.id, name: f.name, type: f.type, size: f.size, createdAt: f.createdAt, dataUrl: await fileToDataUrl(f) }))),
      },
    } as BackupFile;
  });
}

export function parseBackupText(text: string): ValidationResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['Il file non è un JSON valido.'] };
  }
  return validateBackup(raw);
}

/**
 * Ripristino completo: sostituisce TUTTI i dati locali con quelli del backup,
 * in un'unica transazione (se qualcosa fallisce non viene modificato nulla).
 */
export async function restoreBackup(backup: BackupFile): Promise<void> {
  const t = backup.tables;
  const files: StoredFile[] = t.files.map((f) => ({ id: f.id, name: f.name, type: f.type, size: f.size, createdAt: f.createdAt, blob: dataUrlToBlob(f.dataUrl) }));
  await db.transaction('rw', [db.clients, db.rates, db.activities, db.availability, db.ledger, db.documents, db.payments, db.goals, db.audit, db.settings, db.files, db.fiscalParams, db.fiscalDeadlines], async () => {
    await Promise.all([db.clients, db.rates, db.activities, db.availability, db.ledger, db.documents, db.payments, db.goals, db.audit, db.settings, db.files, db.fiscalParams, db.fiscalDeadlines].map((tb) => tb.clear()));
    await db.clients.bulkAdd(t.clients);
    await db.rates.bulkAdd(t.rates);
    await db.activities.bulkAdd(t.activities.map((a) => { const x = { ...a }; if (!x.externalUid) delete x.externalUid; if (!x.seriesId) delete x.seriesId; return x; }));
    await db.availability.bulkAdd(t.availability);
    await db.ledger.bulkAdd(t.ledger);
    await db.documents.bulkAdd(t.documents);
    await db.payments.bulkAdd(t.payments);
    await db.goals.bulkAdd(t.goals);
    await db.audit.bulkAdd(t.audit);
    await db.settings.bulkPut(t.settings.map((s) => ({ key: s.key, value: s.value })));
    await db.files.bulkAdd(files);
    await db.fiscalParams.bulkAdd(t.fiscalParams);
    await db.fiscalDeadlines.bulkAdd(t.fiscalDeadlines);
    await db.audit.add({ id: newId(), entity: 'database', entityId: 'all', action: 'restore', changes: { exportedAt: { from: null, to: backup.exportedAt } }, reason: 'Ripristino da backup', at: new Date().toISOString() });
  });
}

export interface MergeReport {
  activities: number;
  clients: number;
  other: number;
  matchedClients: number;
  skippedDuplicates: number;
}

/**
 * Importazione che AGGIUNGE i dati del file a quelli attuali senza modificare né cancellare
 * nulla di esistente (eccetto i turni aggiunti a un committente che non ne aveva).
 * Un'unica transazione: se qualcosa fallisce non viene modificato nulla.
 */
export async function mergeBackup(backup: BackupFile): Promise<MergeReport> {
  const tables = [db.clients, db.rates, db.activities, db.availability, db.ledger, db.documents, db.payments, db.goals, db.audit, db.files, db.fiscalParams, db.fiscalDeadlines];
  return db.transaction('rw', tables, async () => {
    const plan = planMerge(backup.tables, {
      clients: await db.clients.toArray(),
      rates: await db.rates.toArray(),
      activities: await db.activities.toArray(),
      availability: await db.availability.toArray(),
      ledger: await db.ledger.toArray(),
      documents: await db.documents.toArray(),
      payments: await db.payments.toArray(),
      goals: await db.goals.toArray(),
      fiscalParams: await db.fiscalParams.toArray(),
      fiscalDeadlines: await db.fiscalDeadlines.toArray(),
      files: await db.files.toCollection().primaryKeys().then((ids) => ids.map((id) => ({ id: String(id) }))),
    });
    const a = plan.add;
    await db.clients.bulkAdd(a.clients);
    await db.clients.bulkPut(plan.updateClients.map((c) => ({ ...c, updatedAt: new Date().toISOString() })));
    await db.rates.bulkAdd(a.rates);
    await db.activities.bulkAdd(a.activities.map((x) => { const y = { ...x }; if (!y.externalUid) delete y.externalUid; if (!y.seriesId) delete y.seriesId; return y; }));
    await db.availability.bulkAdd(a.availability);
    await db.ledger.bulkAdd(a.ledger);
    await db.documents.bulkAdd(a.documents);
    await db.payments.bulkAdd(a.payments);
    await db.goals.bulkAdd(a.goals);
    await db.files.bulkAdd(a.files.map((f) => ({ id: f.id, name: f.name, type: f.type, size: f.size, createdAt: f.createdAt, blob: dataUrlToBlob(f.dataUrl) })));
    await db.fiscalParams.bulkAdd(a.fiscalParams);
    await db.fiscalDeadlines.bulkAdd(a.fiscalDeadlines);
    const other = a.rates.length + a.availability.length + a.ledger.length + a.documents.length + a.payments.length + a.goals.length + a.files.length + a.fiscalParams.length + a.fiscalDeadlines.length;
    const report: MergeReport = { activities: a.activities.length, clients: a.clients.length, other, matchedClients: plan.matchedClients, skippedDuplicates: plan.skippedDuplicates };
    await db.audit.add({ id: newId(), entity: 'database', entityId: 'all', action: 'import', changes: { added: { to: report } }, reason: `Aggiunta dati da backup del ${backup.exportedAt}`, at: new Date().toISOString() });
    return report;
  });
}

export async function lastBackupAt(): Promise<string | null> {
  const s = await db.settings.get('lastBackupAt');
  return (s?.value as string | undefined) ?? null;
}
