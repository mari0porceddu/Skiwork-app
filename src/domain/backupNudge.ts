/** Quando proporre un backup: deterministico, basato su età dell'ultimo backup e modifiche successive. */
export const BACKUP_MAX_DAYS = 7;
export const BACKUP_MAX_CHANGES = 15;

export interface BackupNudge {
  show: boolean;
  /** Giorni dall'ultimo backup (null = mai fatto). */
  days: number | null;
  /** Record creati o modificati dopo l'ultimo backup. */
  changes: number;
}

export function backupNudge(lastBackupAt: string | null, records: { updatedAt: string }[], now: Date): BackupNudge {
  const changes = lastBackupAt ? records.filter((r) => r.updatedAt > lastBackupAt).length : records.length;
  if (records.length === 0) return { show: false, days: null, changes: 0 };
  if (!lastBackupAt) return { show: true, days: null, changes };
  const days = Math.floor((now.getTime() - new Date(lastBackupAt).getTime()) / 86_400_000);
  return { show: changes > 0 && (days >= BACKUP_MAX_DAYS || changes >= BACKUP_MAX_CHANGES), days, changes };
}
