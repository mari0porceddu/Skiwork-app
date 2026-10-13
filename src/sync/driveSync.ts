import { useEffect, useState } from 'react';
import { exportBackup, mergeBackup, parseBackupText, type MergeReport } from '../db/backup';
import { setSetting } from '../db/repo';
import { backupNudge } from '../domain/backupNudge';
import { backupRecords } from '../ui/backupActions';
import type { AppData } from '../ui/data';
import { needsPush } from '../domain/gcal';
import { syncCalendar } from './calendar';
import { CALENDAR_SCOPE, downloadBackup, driveAvailable, driveToken, grantedScope, uploadBackup } from './drive';

/** Recupera i dati da Drive aggiungendoli a quelli locali (non cancella nulla). */
export async function recoverFromDrive(token: string): Promise<MergeReport | null> {
  const text = await downloadBackup(token);
  if (!text) return null;
  const v = parseBackupText(text);
  if (!v.ok || !v.data) throw new Error(`Copia su Drive non valida: ${v.errors.slice(0, 2).join('; ')}`);
  return mergeBackup(v.data);
}

/**
 * Salva su Drive. Alla prima sincronizzazione su questo dispositivo prima recupera la copia
 * esistente (es. dopo aver reinstallato l'app), così una installazione vuota non la sovrascrive.
 */
export async function syncToDrive(token: string, firstOnDevice: boolean): Promise<MergeReport | null> {
  const merged = firstOnDevice ? await recoverFromDrive(token) : null;
  const at = new Date().toISOString();
  const b = await exportBackup();
  await uploadBackup(token, JSON.stringify(b));
  await setSetting('driveLastSyncAt', at);
  await setSetting('lastBackupAt', at);
  return merged;
}

let running = false;

/** Salvataggio automatico: pochi secondi dopo ogni modifica, quando c'è rete e l'accesso è valido. */
export function useDriveAutoSync(data: AppData | undefined): void {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    const vis = () => document.visibilityState === 'visible' && bump();
    window.addEventListener('online', bump);
    document.addEventListener('visibilitychange', vis);
    return () => {
      window.removeEventListener('online', bump);
      document.removeEventListener('visibilitychange', vis);
    };
  }, []);
  useEffect(() => {
    if (!data || !data.settings.driveSync || !driveAvailable() || !navigator.onLine) return;
    const first = data.settings.driveLastSyncAt === null;
    const pending = backupNudge(data.settings.driveLastSyncAt, backupRecords(data), new Date()).changes;
    if (!first && pending === 0) return;
    const token = driveToken();
    if (!token) return;
    const t = setTimeout(() => {
      if (running) return;
      running = true;
      syncToDrive(token, first)
        .catch(() => undefined) // riprova alla prossima modifica, al ritorno della rete o all'apertura
        .finally(() => (running = false));
    }, 4000);
    return () => clearTimeout(t);
  }, [data, tick]);
}

let calendarRunning = false;
let lastCalendarRun = 0;
const CALENDAR_PULL_EVERY = 2 * 60_000;

/** Calendario Google: all'apertura, al ritorno nell'app e dopo ogni modifica alle attività. */
export function useCalendarAutoSync(data: AppData | undefined): void {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    const vis = () => document.visibilityState === 'visible' && bump();
    window.addEventListener('online', bump);
    document.addEventListener('visibilitychange', vis);
    return () => {
      window.removeEventListener('online', bump);
      document.removeEventListener('visibilitychange', vis);
    };
  }, []);
  useEffect(() => {
    if (!data || !data.settings.calendarSync || !driveAvailable() || !navigator.onLine || !grantedScope(CALENDAR_SCOPE)) return;
    const localChanges = data.settings.gcalPendingDeletes.length > 0 || data.activities.some(needsPush);
    if (!localChanges && Date.now() - lastCalendarRun < CALENDAR_PULL_EVERY) return;
    const token = driveToken();
    if (!token) return;
    const t = setTimeout(() => {
      if (calendarRunning) return;
      calendarRunning = true;
      lastCalendarRun = Date.now();
      syncCalendar(token)
        .catch(() => undefined)
        .finally(() => (calendarRunning = false));
    }, 3000);
    return () => clearTimeout(t);
  }, [data, tick]);
}
