# Architettura

## Stack e motivazioni

| Scelta | Perché |
|---|---|
| React 18 + TypeScript + Vite | Diffusi, gratuiti, tipizzazione forte sui dati economici, build veloce. |
| PWA (vite-plugin-pwa / Workbox) | Installabile su iPhone e usabile da computer senza App Store; service worker per l'offline. |
| IndexedDB tramite Dexie | Persistenza locale affidabile (non la cache), transazioni, indici, migrazioni versionate. |
| zod | Validazione rigorosa dei backup importati. |
| CSS proprio, nessuna libreria UI | Bundle piccolo; componenti accessibili basati su elementi nativi (`<dialog>`, `<select>`, input data/ora nativi di iOS). |
| Vitest + Playwright | Test del dominio senza interfaccia; test end-to-end in Chromium, incluso l'offline. |

Nessun backend: tutte le funzioni essenziali girano sul dispositivo.

## Struttura

```
src/domain/   logica pura, senza UI né database (testabile da sola)
  money.ts         importi in centesimi interi, arrotondamenti
  time.ts          date/ore di calendario, attraversamento mezzanotte
  compensation.ts  motore dei compensi e scelta della tariffa
  schedule.ts      conflitti, ricorrenze, disponibilità e slot liberi
  reports.ts       totali derivati e riconducibili alle registrazioni
  documents.ts     stati dei documenti, scadenze, crediti residui
  goals.ts         avanzamento obiettivi, ritmo, previsione
  reminders.ts     promemoria deterministici con ID stabili
  ics.ts           import/export iCalendar senza duplicati
  backup.ts        formato e validazione del backup
  csv.ts           export CSV
  fiscal.ts        modulo fiscale parametrico (stima solo con parametri verificati)
src/db/       persistenza (Dexie): schema, scritture con registro modifiche, backup
src/ui/       interfaccia React (pagine, form, componenti)
tests/        test unitari e di persistenza
e2e/          test end-to-end nel browser
```

## Modello dati (IndexedDB, versione 2)

`clients`, `rates`, `activities`, `availability`, `ledger` (rimborsi, spese, accantonamenti), `documents`, `payments`, `goals`, `audit` (registro modifiche), `settings`, `files` (allegati); dalla versione 2 anche `fiscalParams` e `fiscalDeadlines`.

Principi:
- Gli importi sono interi in centesimi.
- Ogni attività conserva una **copia della tariffa applicata**: modificare una tariffa non cambia lo storico.
- **Nessun totale memorizzato**: i report sono ricalcolati dalle registrazioni e ogni valore elenca gli ID che lo compongono (tocca un indicatore per vederli).
- `externalUid` è un indice unico: le importazioni ICS non creano duplicati.
- Le modifiche ai campi economici di un'attività completata richiedono una motivazione e finiscono nel registro modifiche.
- Migrazioni: ogni cambio di schema aggiunge una nuova `db.version(n)` in `src/db/db.ts`, senza modificare le precedenti.

## Stato per fase

**Fase 1 (MVP), fatto:** PWA, database locale, dashboard, calendario (giorno/settimana/mese, ricorrenze, conflitti, trasferimenti, cancellati), inserimento rapido, tariffe con validità, ore e compensi, disponibilità e slot liberi, obiettivi, backup/ripristino JSON, export CSV.

Anticipato dalle fasi successive in forma base: registro documenti con pagamenti parziali e allegati, crediti residui, rimborsi/spese/accantonamenti, promemoria nell'app, import/export ICS.

**Fase 2, fatto:** modulo fiscale parametrico (parametri con fonte, anno, ambito, stato di verifica e storico; stima solo con parametri verificati; simulazione di scenari), scadenze fiscali con promemoria, andamento mensile per stagione/anno con export CSV, migrazione del database alla versione 2.

**Fase 3:** fatto la pubblicazione automatica su GitHub Pages e la CI (`.github/workflows`). Da fare: notifiche di sistema dove supportate, rifiniture UX.

## Informazioni ancora necessarie (solo per la stima fiscale)

Da verificare con il commercialista, quando vuoi attivare la stima: gestione previdenziale e trattamento di ciascun committente (scuola di sci e ASD separatamente), coefficiente di redditività, aliquota dell'imposta sostitutiva, regole contributive e acconti, eventuali agevolazioni. Nient'altro blocca l'uso dell'app.
