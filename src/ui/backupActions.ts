import { exportBackup } from '../db/backup';
import { setSetting } from '../db/repo';
import { todayISO } from '../domain/time';
import { saveFile } from './download';

/** Crea il file di backup completo e registra la data dell'ultimo backup. */
export async function createBackupFile(): Promise<void> {
  const b = await exportBackup();
  await saveFile(`skiwork-backup-${todayISO()}.json`, JSON.stringify(b, null, 2), 'application/json');
  await setSetting('lastBackupAt', new Date().toISOString());
}

/** iPhone/iPad con l'app aperta in Safari invece che dall'icona sulla schermata Home. */
export function isIosBrowserTab(): boolean {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  return ios && (navigator as Navigator & { standalone?: boolean }).standalone !== true;
}
