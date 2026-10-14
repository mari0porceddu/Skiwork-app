import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/config', () => ({ GOOGLE_CLIENT_ID: 'test-client' }));

function memStorage(): Storage {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, String(v)), removeItem: (k) => void m.delete(k), clear: () => m.clear(), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } };
}

let hash = '';
beforeEach(() => {
  hash = '';
  vi.stubGlobal('localStorage', memStorage());
  vi.stubGlobal('sessionStorage', memStorage());
  vi.stubGlobal('location', { origin: 'https://x.github.io', pathname: '/app/', search: '', get hash() { return hash; }, assign: vi.fn() });
  vi.stubGlobal('history', { replaceState: (_s: unknown, _t: string, url: string) => { hash = url.slice(url.indexOf('#')); } });
  vi.stubGlobal('window', { dispatchEvent: vi.fn() });
  vi.stubGlobal('HashChangeEvent', class { constructor(public type: string) {} });
});

const drive = () => import('../src/sync/drive');

describe('accesso Google Drive', () => {
  it('accetta il token solo con lo stato atteso e ripulisce l’indirizzo', async () => {
    const d = await drive();
    sessionStorage.setItem('skiwork.drive.state', 'abc');
    hash = '#access_token=tok&expires_in=3600&state=abc&token_type=Bearer';
    expect(d.consumeAuthRedirect()).toEqual({ kind: 'ok', intent: 'drive' });
    expect(hash).toBe('#/impostazioni');
    expect(d.driveToken()).toBe('tok');

    sessionStorage.setItem('skiwork.drive.state', 'abc');
    hash = '#access_token=evil&state=other';
    expect(d.consumeAuthRedirect().kind).toBe('error');
    expect(d.driveToken()).toBe('tok');
  });

  it('ignora gli indirizzi normali dell’app', async () => {
    const d = await drive();
    hash = '#/attivita?x=1';
    expect(d.consumeAuthRedirect()).toEqual({ kind: 'none' });
  });

  it('crea il file la prima volta, poi lo aggiorna; un 401 cancella il token', async () => {
    const d = await drive();
    localStorage.setItem('skiwork.drive', JSON.stringify({ token: 't', expiresAt: Date.now() + 3600_000 }));
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url.split('?')[0]}`);
      if (url.startsWith('https://www.googleapis.com/drive/v3/files?')) return new Response(JSON.stringify({ files: [] }));
      if (init?.method === 'POST') return new Response(JSON.stringify({ id: 'f1' }));
      return new Response('{}');
    }));
    await d.uploadBackup('t', '{"a":1}');
    await d.uploadBackup('t', '{"a":2}');
    expect(calls).toEqual(['GET https://www.googleapis.com/drive/v3/files', 'POST https://www.googleapis.com/upload/drive/v3/files', 'PATCH https://www.googleapis.com/upload/drive/v3/files/f1']);

    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 401 })));
    await expect(d.uploadBackup('t', '{}')).rejects.toBeInstanceOf(d.DriveAuthError);
    expect(d.driveToken()).toBeNull();
  });
});

describe('rinnovo automatico dell’accesso', () => {
  it('rinnova da solo solo se attivo, scaduto, online e non tentato di recente', async () => {
    const d = await drive();
    vi.stubGlobal('navigator', { onLine: true });
    hash = '#/calendario';
    expect(d.trySilentReconnect(false)).toBe(false);
    expect(d.trySilentReconnect(true)).toBe(true);
    expect(String((location.assign as ReturnType<typeof vi.fn>).mock.calls[0]?.[0])).toContain('prompt=none');
    expect(d.trySilentReconnect(true)).toBe(false); // appena tentato

    // Google non può rinnovare senza l’utente: nessun errore mostrato, si torna dov’eri, niente nuovi tentativi per ore
    hash = `#error=interaction_required&state=${localStorage.getItem('skiwork.drive.state')}`;
    expect(d.consumeAuthRedirect()).toEqual({ kind: 'silent-failed' });
    expect(hash).toBe('#/calendario');
    expect(d.trySilentReconnect(true, Date.now() + 20 * 60_000)).toBe(false);
    expect(d.trySilentReconnect(true, Date.now() + 7 * 3_600_000)).toBe(true);
  });

  it('con un token valido non fa nulla', async () => {
    const d = await drive();
    vi.stubGlobal('navigator', { onLine: true });
    localStorage.setItem('skiwork.drive', JSON.stringify({ token: 't', expiresAt: Date.now() + 3600_000 }));
    expect(d.trySilentReconnect(true)).toBe(false);
  });
});

describe('sincronizzazione', () => {
  it('alla prima sincronizzazione su un dispositivo recupera la copia su Drive prima di sovrascriverla', async () => {
    const D = await import('../src/db/db');
    const { SkiWorkDB, useDatabase } = D;
    const { saveActivity, saveRecord } = await import('../src/db/repo');
    const { exportBackup } = await import('../src/db/backup');
    const { activity, client } = await import('./fixtures');
    // Copia "vecchia" su Drive con un'attività
    useDatabase(new SkiWorkDB('drive-src'));
    await D.db.open();
    await saveRecord('clients', client({ id: 'c', name: 'Club' }));
    await saveActivity(activity({ id: 'remote', clientId: 'c' }));
    const remote = JSON.stringify(await exportBackup());
    D.db.close();
    // Telefono nuovo, vuoto
    useDatabase(new SkiWorkDB('drive-new'));
    await D.db.open();
    localStorage.setItem('skiwork.drive', JSON.stringify({ token: 't', expiresAt: Date.now() + 3600_000, fileId: 'f1' }));
    let uploaded = '';
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('alt=media')) return new Response(remote);
      if (init?.method === 'PATCH') uploaded = String(init.body);
      return new Response('{}');
    }));
    const { syncToDrive } = await import('../src/sync/driveSync');
    const r = await syncToDrive('t', true);
    expect(r?.activities).toBe(1);
    expect(await D.db.activities.get('remote')).toBeDefined();
    expect(JSON.parse(uploaded).tables.activities.map((a: { id: string }) => a.id)).toEqual(['remote']);
  });
});
