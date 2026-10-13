# SkiWork

PWA personale per gestire il lavoro da maestro di sci e allenatore: calendario, disponibilità, attività, compensi, documenti, pagamenti, obiettivi. Funziona offline, salva i dati sul dispositivo, nessuna AI, nessuna telemetria, nessun servizio a pagamento.

## Avvio

Requisiti: Node.js 20 o superiore.

```bash
npm install
npm run dev        # sviluppo su http://localhost:5173
npm test           # test unitari (motore di calcolo, database, backup)
npm run test:e2e   # test end-to-end nel browser (compila l'app, verifica anche l'offline)
npm run build      # build di produzione in dist/
npm run preview    # serve la build su http://localhost:4173
```

## Installazione su iPhone

Una PWA va servita via **HTTPS** da un indirizzo stabile. Il repository include la pubblicazione automatica su **GitHub Pages** (`.github/workflows/pages.yml`): basta attivarla una volta in GitHub → Settings → Pages → Source: **GitHub Actions**. A ogni aggiornamento di `main` l'app viene ricompilata, testata e pubblicata su `https://<utente>.github.io/<repository>/`. GitHub Pages su repository privati richiede un piano a pagamento: in alternativa rendi pubblico il repository (il codice non contiene dati personali) oppure usa Netlify o Cloudflare Pages (gratuiti) puntando alla cartella `dist/`. Poi:

1. Apri l'indirizzo con **Safari** su iPhone.
2. Tocca Condividi → **Aggiungi alla schermata Home**.
3. Apri SkiWork dall'icona. Dopo il primo caricamento funziona anche senza rete.

Dettagli e limiti di iOS: [docs/IOS.md](docs/IOS.md).

## Dati e backup

I dati sono nel database del browser (IndexedDB) **solo su quel dispositivo**. Si possono perdere se cancelli i dati del sito o rimuovi l'app. Fai regolarmente **Impostazioni → Scarica backup completo** e conserva il file (es. su iCloud Drive). Il ripristino sostituisce tutti i dati dopo una validazione completa del file e una conferma.

Telefono e computer hanno database separati: la sincronizzazione è un'estensione futura. Per ora si passa da un dispositivo all'altro con backup e ripristino.

## Documentazione

- [docs/ARCHITETTURA.md](docs/ARCHITETTURA.md): struttura, scelte tecniche, modello dati, roadmap.
- [docs/CALCOLI.md](docs/CALCOLI.md): tutte le formule e le regole di calcolo.
- [docs/IOS.md](docs/IOS.md): installazione, notifiche e limiti delle PWA su iPhone.
