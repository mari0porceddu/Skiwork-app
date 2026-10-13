import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { DEFAULT_REMINDER_SETTINGS, type ReminderSettings } from '../domain/reminders';
import type { FiscalDeadline, FiscalParam } from '../domain/fiscal';
import type { Activity, AvailabilityRule, Client, Goal, LedgerEntry, Payment, Rate, WorkDocument } from '../domain/types';

/**
 * Dati letti in tempo reale dal database locale. Per un uso personale i volumi sono contenuti
 * (migliaia di record), quindi si caricano le tabelle intere e si filtra in memoria
 * con le funzioni pure del dominio.
 */
export interface AppData {
  clients: Client[];
  rates: Rate[];
  activities: Activity[];
  availability: AvailabilityRule[];
  ledger: LedgerEntry[];
  documents: WorkDocument[];
  payments: Payment[];
  goals: Goal[];
  fiscalParams: FiscalParam[];
  fiscalDeadlines: FiscalDeadline[];
  settings: AppSettings;
}

export interface AppSettings {
  theme: 'system' | 'light' | 'dark';
  defaultTravelMinutes: number;
  minSlotMinutes: number;
  lastClientId: string | null;
  lastActivityType: string | null;
  usualStart: string;
  usualEnd: string;
  reminders: ReminderSettings;
  manualSetAsideBps: number | null;
  lastBackupAt: string | null;
  /** Salvataggio automatico su Google Drive attivo su questo dispositivo. */
  driveSync: boolean;
  driveLastSyncAt: string | null;
  /** Inizio e fine stagione (MM-DD), configurabili. */
  seasonStart: string;
  seasonEnd: string;
  /** Profilo fiscale dichiarato, compilato dall'utente (testo libero per voce). */
  fiscalProfile: Record<string, { value: string; status: string }>;
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  defaultTravelMinutes: 0,
  minSlotMinutes: 60,
  lastClientId: null,
  lastActivityType: null,
  usualStart: '09:00',
  usualEnd: '11:00',
  reminders: DEFAULT_REMINDER_SETTINGS,
  manualSetAsideBps: null,
  lastBackupAt: null,
  driveSync: false,
  driveLastSyncAt: null,
  seasonStart: '11-01',
  seasonEnd: '04-30',
  fiscalProfile: {},
};

export function useAppData(): AppData | undefined {
  return useLiveQuery(async () => {
    const [clients, rates, activities, availability, ledger, documents, payments, goals, settingsRows, fiscalParams, fiscalDeadlines] = await Promise.all([
      db.clients.toArray(),
      db.rates.toArray(),
      db.activities.toArray(),
      db.availability.toArray(),
      db.ledger.toArray(),
      db.documents.toArray(),
      db.payments.toArray(),
      db.goals.toArray(),
      db.settings.toArray(),
      db.fiscalParams.toArray(),
      db.fiscalDeadlines.toArray(),
    ]);
    const settings: AppSettings = { ...DEFAULT_SETTINGS };
    for (const s of settingsRows) if (s.key in settings) (settings as unknown as Record<string, unknown>)[s.key] = s.value;
    settings.reminders = { ...DEFAULT_REMINDER_SETTINGS, ...settings.reminders, enabled: { ...DEFAULT_REMINDER_SETTINGS.enabled, ...settings.reminders?.enabled } };
    activities.sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
    clients.sort((a, b) => a.name.localeCompare(b.name));
    fiscalDeadlines.sort((a, b) => a.date.localeCompare(b.date));
    return { clients, rates, activities, availability, ledger, documents, payments, goals, fiscalParams, fiscalDeadlines, settings };
  }, []);
}
