import Dexie, { type EntityTable } from 'dexie';
import type { FiscalDeadline, FiscalParam } from '../domain/fiscal';
import type {
  Activity,
  AuditEntry,
  AvailabilityRule,
  Client,
  Goal,
  LedgerEntry,
  Payment,
  Rate,
  Setting,
  StoredFile,
  WorkDocument,
} from '../domain/types';

export const DB_NAME = 'skiwork';

export class SkiWorkDB extends Dexie {
  clients!: EntityTable<Client, 'id'>;
  rates!: EntityTable<Rate, 'id'>;
  activities!: EntityTable<Activity, 'id'>;
  availability!: EntityTable<AvailabilityRule, 'id'>;
  ledger!: EntityTable<LedgerEntry, 'id'>;
  documents!: EntityTable<WorkDocument, 'id'>;
  payments!: EntityTable<Payment, 'id'>;
  goals!: EntityTable<Goal, 'id'>;
  audit!: EntityTable<AuditEntry, 'id'>;
  settings!: EntityTable<Setting, 'key'>;
  files!: EntityTable<StoredFile, 'id'>;
  fiscalParams!: EntityTable<FiscalParam, 'id'>;
  fiscalDeadlines!: EntityTable<FiscalDeadline, 'id'>;

  constructor(name = DB_NAME) {
    super(name);
    // Migrazioni: ogni modifica allo schema aggiunge una nuova versione con eventuale .upgrade().
    // Non modificare le versioni già rilasciate.
    this.version(1).stores({
      clients: 'id, name, kind, active',
      rates: 'id, clientId, activityType, validFrom',
      activities: 'id, date, clientId, status, type, seriesId, &externalUid',
      availability: 'id, kind, date',
      ledger: 'id, kind, date, clientId, activityId',
      documents: 'id, clientId, issueDate, dueDate, status',
      payments: 'id, documentId, clientId, date',
      goals: 'id, metric',
      audit: 'id, entity, entityId, at',
      settings: 'key',
      files: 'id',
    });
    // v2: modulo fiscale parametrico e scadenze fiscali
    this.version(2).stores({
      fiscalParams: 'id, key, year, clientId',
      fiscalDeadlines: 'id, date, done',
    });
  }
}

export const DB_VERSION = 2;

export let db = new SkiWorkDB();

/** Solo per i test: usa un database diverso. */
export function useDatabase(instance: SkiWorkDB): void {
  db = instance;
}

export const TABLES = ['clients', 'rates', 'activities', 'availability', 'ledger', 'documents', 'payments', 'goals', 'audit', 'settings', 'fiscalParams', 'fiscalDeadlines'] as const;
