import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { db } from './db/db';
import { ensureSeed, setSetting } from './db/repo';
import { consumeAuthRedirect } from './sync/drive';
import { App } from './ui/App';
import './ui/styles.css';

async function start() {
  const root = createRoot(document.getElementById('root')!);
  try {
    await db.open();
    await ensureSeed();
    // Ritorno dalla pagina di accesso Google: attiva il salvataggio su Drive su questo dispositivo.
    if (consumeAuthRedirect().kind === 'ok') await setSetting('driveSync', true);
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
