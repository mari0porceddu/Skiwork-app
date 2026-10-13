/**
 * Salvataggio automatico su Google Drive dell'utente (cartella dati dell'app, non visibile in Drive).
 * Solo dal browser, senza server: accesso OAuth "implicit" con reindirizzamento (funziona anche
 * nelle web app installate su iPhone, dove i popup sono inaffidabili). Il token dura circa un'ora
 * e resta solo su questo dispositivo (localStorage), mai nel database né nei backup.
 */
import { GOOGLE_CLIENT_ID } from '../config';

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
/** Solo calendari creati dall'app (il calendario "SkiWork") e i loro eventi. */
export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.app.created';
const FILE_NAME = 'skiwork-backup.json';
const KEY = 'skiwork.drive';
const STATE_KEY = 'skiwork.drive.state';

interface Stored {
  token: string;
  expiresAt: number;
  scope?: string;
  fileId?: string;
}

export class DriveAuthError extends Error {}

export class GoogleApiError extends Error {
  constructor(public status: number) {
    super(`Google ha risposto ${status}`);
  }
}

export const driveAvailable = (): boolean => GOOGLE_CLIENT_ID !== '';

function read(): Stored | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Stored) : null;
  } catch {
    return null;
  }
}

function write(s: Stored | null): void {
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    /* archiviazione non disponibile: si richiederà di nuovo l'accesso */
  }
}

/** Token valido per almeno un altro minuto, se presente. */
export function driveToken(now = Date.now()): string | null {
  const s = read();
  return s && s.expiresAt - 60_000 > now ? s.token : null;
}

/** Permessi concessi dall'utente con l'ultimo accesso (può togliere quelli che non vuole). */
export function grantedScope(scope: string): boolean {
  return (read()?.scope ?? '').split(' ').includes(scope);
}

export function forgetDriveToken(): void {
  write(null);
}

export function redirectUri(): string {
  return location.origin + location.pathname;
}

/** Porta alla pagina di accesso Google; al ritorno l'app riparte e chiama consumeAuthRedirect. */
/** drive/calendar: attiva la funzione al ritorno; reconnect: rinnova solo l'accesso. */
export type AuthIntent = 'drive' | 'calendar' | 'reconnect';
const INTENT_KEY = 'skiwork.google.intent';

export function startDriveAuth(intent: AuthIntent = 'drive'): void {
  const state = crypto.randomUUID();
  try {
    localStorage.setItem(INTENT_KEY, intent);
    sessionStorage.setItem(STATE_KEY, state);
    localStorage.setItem(STATE_KEY, state);
  } catch {
    /* ignorato */
  }
  const p = new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, redirect_uri: redirectUri(), response_type: 'token', scope: `${DRIVE_SCOPE} ${CALENDAR_SCOPE}`, include_granted_scopes: 'true', state });
  location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${p}`);
}

/** Esito dell'ultimo ritorno dalla pagina di accesso, mostrato una volta dalle Impostazioni. */
export let lastAuthResult: AuthReturn = { kind: 'none' };
export function takeAuthResult(): AuthReturn {
  const r = lastAuthResult;
  lastAuthResult = { kind: 'none' };
  return r;
}

export type AuthReturn = { kind: 'none' } | { kind: 'ok'; intent: AuthIntent } | { kind: 'error'; message: string };

/** Legge l'esito dell'accesso dall'indirizzo (#access_token=...) e lo ripulisce subito. */
export function consumeAuthRedirect(): AuthReturn {
  lastAuthResult = parseAuthRedirect();
  return lastAuthResult;
}

function parseAuthRedirect(): AuthReturn {
  const h = location.hash.replace(/^#/, '');
  if (!/(^|&)(access_token|error)=/.test(h)) return { kind: 'none' };
  const p = new URLSearchParams(h);
  history.replaceState(null, '', location.pathname + location.search + '#/impostazioni');
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  let expected: string | null = null;
  try {
    expected = sessionStorage.getItem(STATE_KEY) ?? localStorage.getItem(STATE_KEY);
    sessionStorage.removeItem(STATE_KEY);
    localStorage.removeItem(STATE_KEY);
  } catch {
    /* ignorato */
  }
  if (!expected || p.get('state') !== expected) return { kind: 'error', message: 'Risposta di accesso non valida, riprova.' };
  const error = p.get('error');
  if (error) return { kind: 'error', message: error === 'access_denied' ? 'Accesso a Google annullato.' : `Accesso a Google non riuscito (${error}).` };
  const token = p.get('access_token');
  const expiresIn = Number(p.get('expires_in') ?? '3600');
  if (!token) return { kind: 'error', message: 'Accesso a Google non riuscito.' };
  write({ ...read(), token, expiresAt: Date.now() + expiresIn * 1000, scope: p.get('scope') ?? '' });
  let intent: AuthIntent = 'drive';
  try {
    const v = localStorage.getItem(INTENT_KEY);
    if (v === 'calendar' || v === 'reconnect') intent = v;
    localStorage.removeItem(INTENT_KEY);
  } catch {
    /* ignorato */
  }
  return { kind: 'ok', intent };
}

export async function api(token: string, url: string, init: RequestInit = {}): Promise<Response> {
  const r = await fetch(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` } });
  if (r.status === 401) {
    forgetDriveToken();
    throw new DriveAuthError('Accesso a Google scaduto');
  }
  if (!r.ok) throw new GoogleApiError(r.status);
  return r;
}

async function findFileId(token: string): Promise<string | null> {
  const cached = read()?.fileId;
  if (cached) return cached;
  const q = new URLSearchParams({ spaces: 'appDataFolder', q: `name='${FILE_NAME}'`, fields: 'files(id)', pageSize: '1' });
  const r = await api(token, `https://www.googleapis.com/drive/v3/files?${q}`);
  const id = ((await r.json()) as { files: { id: string }[] }).files[0]?.id ?? null;
  const s = read();
  if (id && s) write({ ...s, fileId: id });
  return id;
}

/** Carica il backup (crea il file la prima volta, poi lo aggiorna: Drive conserva le versioni precedenti). */
export async function uploadBackup(token: string, json: string): Promise<void> {
  const id = await findFileId(token);
  if (id) {
    try {
      await api(token, `https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: json });
      return;
    } catch (e) {
      if (e instanceof DriveAuthError) throw e;
      const s = read();
      if (s) write({ ...s, fileId: undefined }); // file rimosso: lo si ricrea
    }
  }
  const boundary = `skiwork${Date.now()}`;
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: FILE_NAME, parents: ['appDataFolder'] })}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${json}\r\n--${boundary}--`;
  const r = await api(token, 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body });
  const created = (await r.json()) as { id: string };
  const s = read();
  if (s) write({ ...s, fileId: created.id });
}

/** Scarica l'ultimo backup salvato su Drive (null se non esiste). */
export async function downloadBackup(token: string): Promise<string | null> {
  const id = await findFileId(token);
  if (!id) return null;
  const r = await api(token, `https://www.googleapis.com/drive/v3/files/${id}?alt=media`);
  return r.text();
}
