import type { BackupFile } from './backup';
import type { Client, ID } from './types';

/** Tabelle unite da un'importazione "aggiungi senza cancellare" (impostazioni e registro restano quelli attuali). */
export const MERGE_TABLES = ['clients', 'rates', 'activities', 'availability', 'ledger', 'documents', 'payments', 'goals', 'fiscalParams', 'fiscalDeadlines', 'files'] as const;
export type MergeTable = (typeof MERGE_TABLES)[number];

type Tables = BackupFile['tables'];
type Existing = Record<Exclude<MergeTable, 'clients' | 'activities'>, { id: ID }[]> & { clients: Client[]; activities: Tables['activities'] };

export interface MergePlan {
  add: { [K in MergeTable]: Tables[K] };
  /** Committenti già presenti a cui si aggiungono i turni del file (solo se non ne avevano). */
  updateClients: Client[];
  /** Committenti del file riconosciuti per nome tra quelli già presenti. */
  matchedClients: number;
  skippedDuplicates: number;
}

const norm = (s: string) => s.trim().toLocaleLowerCase('it');

function activityKey(a: { date: string; start: string; end: string; clientId: ID | null; type: string; title: string }): string {
  return [a.date, a.start, a.end, a.clientId ?? '', a.type, norm(a.title)].join('|');
}

/**
 * Pianifica l'unione di un backup con i dati attuali senza modificare né cancellare nulla di esistente.
 * - record con id già presente: ignorati;
 * - committenti con lo stesso nome di uno esistente: unificati (i riferimenti vengono rimappati);
 * - attività identiche (data, orari, committente, tipologia, titolo) o con lo stesso UID esterno: ignorate.
 */
export function planMerge(incoming: Tables, existing: Existing): MergePlan {
  const clientMap = new Map<ID, ID>();
  const existingClientIds = new Set(existing.clients.map((c) => c.id));
  const byName = new Map(existing.clients.map((c) => [norm(c.name), c]));
  const addClients: Client[] = [];
  const updateClients: Client[] = [];
  let matchedClients = 0;
  for (const c of incoming.clients) {
    if (existingClientIds.has(c.id)) continue;
    const same = byName.get(norm(c.name));
    if (same) {
      clientMap.set(c.id, same.id);
      matchedClients++;
      if (!same.shifts && c.shifts) updateClients.push({ ...same, shifts: c.shifts });
    } else {
      addClients.push(c);
      byName.set(norm(c.name), c);
    }
  }
  const remap = <T extends { clientId?: ID | null }>(r: T): T => (r.clientId && clientMap.has(r.clientId) ? { ...r, clientId: clientMap.get(r.clientId)! } : r);
  const fresh = <T extends { id: ID }>(table: MergeTable, rows: T[]): T[] => {
    const ids = new Set((existing[table] as { id: ID }[]).map((r) => r.id));
    return rows.filter((r) => !ids.has(r.id));
  };

  const seen = new Set(existing.activities.map(activityKey));
  const uids = new Set(existing.activities.map((a) => a.externalUid).filter(Boolean));
  let skippedDuplicates = 0;
  const activities = fresh('activities', incoming.activities.map(remap)).filter((a) => {
    const k = activityKey(a);
    if (seen.has(k) || (a.externalUid && uids.has(a.externalUid))) {
      skippedDuplicates++;
      return false;
    }
    seen.add(k);
    if (a.externalUid) uids.add(a.externalUid);
    return true;
  });

  return {
    add: {
      clients: addClients,
      rates: fresh('rates', incoming.rates.map(remap)),
      activities,
      availability: fresh('availability', incoming.availability),
      ledger: fresh('ledger', incoming.ledger.map(remap)),
      documents: fresh('documents', incoming.documents.map(remap)),
      payments: fresh('payments', incoming.payments.map(remap)),
      goals: fresh('goals', incoming.goals.map(remap)),
      fiscalParams: fresh('fiscalParams', incoming.fiscalParams.map(remap)),
      fiscalDeadlines: fresh('fiscalDeadlines', incoming.fiscalDeadlines),
      files: fresh('files', incoming.files),
    },
    updateClients,
    matchedClients,
    skippedDuplicates,
  };
}
