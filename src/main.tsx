import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { db } from './db/db';
import { ensureSeed, setSetting } from './db/repo';
import { consumeAuthRedirect, trySilentReconnect } from './sync/drive';
import { App } from './ui/App';
import './ui/styles.css';

async function start() {
  const root = createRoot(document.getElementById('root')!);
  try {
    await db.open();
    await ensureSeed();
    // Ritorno dalla pagina di accesso Google: attiva Drive o Calendar su questo dispositivo.
    const auth = consumeAuthRedirect();
    if (auth.kind === 'ok' && auth.intent !== 'reconnect') await setSetting(auth.intent === 'calendar' ? 'calendarSync' : 'driveSync', true);
    // Accesso Google scaduto: lo rinnova da solo all'apertura (la pagina va da Google e torna subito).
    if (auth.kind === 'none') {
      const on = async (k: string) => (await db.settings.get(k))?.value === true;
      if (trySilentReconnect((await on('driveSync')) || (await on('calendarSync')))) return;
    }
    // Chiede al browser di non eliminare automaticamente i dati (best effort).
    void navigator.storage?.persist?.();
  } catch (e) {
    root.render(
      <div className="fatal">
        <h1>Impossibile aprire il database locale</h1>
        <p>{(e as Error).message}</p>
        <p>Su iPhone, verifica di non essere in navigazione privata e che ci sia spazio disponibile.</p>
      </div>,
    );
    return;
  }
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

// Nell'anteprima senza service worker (VITE_NO_SW) l'app funziona ma non offline.
if (!import.meta.env.VITE_NO_SW && 'serviceWorker' in navigator) {
  void import('virtual:pwa-register').then((m) => m.registerSW({ immediate: true }));
}
void start();
