import type { BackupFile } from './backup';
import { planShiftRealign } from './shifts';
import type { Activity, Client, ID } from './types';

/** Tabelle unite da un'importazione "aggiungi senza cancellare" (impostazioni e registro restano quelli attuali). */
export const MERGE_TABLES = ['clients', 'rates', 'activities', 'availability', 'ledger', 'documents', 'payments', 'goals', 'fiscalParams', 'fiscalDeadlines', 'files'] as const;
export type MergeTable = (typeof MERGE_TABLES)[number];

type Tables = BackupFile['tables'];
type Existing = Record<Exclude<MergeTable, 'clients' | 'activities'>, { id: ID }[]> & { clients: Client[]; activities: Tables['activities'] };

export interface MergePlan {
  add: { [K in MergeTable]: Tables[K] };
  /** Committenti già presenti aggiornati: versione più recente del file o turni aggiunti a chi non ne aveva. */
  updateClients: Client[];
  /** Attività già presenti (stesso id) sostituite dalla versione più recente del file, più quelle riallineate ai turni aggiornati. */
  updateActivities: Activity[];
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
 * - committenti e attività con id già presente: sostituiti solo se la copia nel file è più recente
 *   (updatedAt successivo); i collegamenti a Google Calendar del dispositivo restano se il file non li ha;
 * - altri record con id già presente: ignorati;
 * - committenti con lo stesso nome di uno esistente: unificati (i riferimenti vengono rimappati);
 * - attività identiche (data, orari, committente, tipologia, titolo) o con lo stesso UID esterno: ignorate.
 */
export function planMerge(incoming: Tables, existing: Existing): MergePlan {
  const clientMap = new Map<ID, ID>();
  const clientById = new Map(existing.clients.map((c) => [c.id, c]));
  const byName = new Map(existing.clients.map((c) => [norm(c.name), c]));
  const addClients: Client[] = [];
  const updateClients: Client[] = [];
  let matchedClients = 0;
  for (const c of incoming.clients) {
    const current = clientById.get(c.id);
    if (current) {
      if (c.updatedAt > current.updatedAt) updateClients.push(c);
      continue;
    }
    const same = byName.get(norm(c.name));
    if (same) {
      clientMap.set(c.id, same.id);
      matchedClients++;
      if (!same.shifts && c.shifts) updateClients.push({ ...same, shifts: c.shifts, updatedAt: c.updatedAt > same.updatedAt ? c.updatedAt : same.updatedAt });
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

  const activityById = new Map(existing.activities.map((a) => [a.id, a]));
  const updated = new Map<ID, Activity>();
  for (const a of incoming.activities.map(remap)) {
    const current = activityById.get(a.id);
    if (!current || !(a.updatedAt > current.updatedAt)) continue;
    updated.set(a.id, {
      ...a,
      gcalEventId: a.gcalEventId ?? current.gcalEventId,
      gcalSyncedAt: a.gcalSyncedAt ?? current.gcalSyncedAt,
      gcalUpdated: a.gcalUpdated ?? current.gcalUpdated,
    } as Activity);
  }
  // Le attività non presenti nel file seguono i nuovi orari dei turni dei committenti aggiornati.
  for (const c of updateClients) {
    const others = existing.activities.filter((a) => !updated.has(a.id)) as Activity[];
    for (const a of planShiftRealign(c, others)) updated.set(a.id, { ...a, updatedAt: c.updatedAt });
  }

  const seen = new Set(existing.activities.map((a) => activityKey(updated.get(a.id) ?? a)));
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
    updateActivities: [...updated.values()],
    matchedClients,
    skippedDuplicates,
  };
}

type Profile = Record<string, { value: string; status: string }>;

/** Profilo fiscale: dal file si prendono solo le voci ancora vuote nell'app. */
export function mergeFiscalProfile(current: Profile, incoming: unknown): { profile: Profile; filled: number } {
  const profile = { ...current };
  let filled = 0;
  if (!incoming || typeof incoming !== 'object') return { profile, filled };
  for (const [k, v] of Object.entries(incoming as Record<string, unknown>)) {
    const value = (v as { value?: unknown } | null)?.value;
    if (typeof value !== 'string' || !value.trim() || profile[k]?.value?.trim()) continue;
    profile[k] = { value, status: String((v as { status?: unknown }).status ?? '') };
    filled++;
  }
  return { profile, filled };
}
