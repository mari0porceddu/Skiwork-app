# iPhone: installazione e limiti

## Installazione
Apri l'indirizzo HTTPS dell'app in **Safari** → Condividi → **Aggiungi alla schermata Home**. Le PWA si installano solo da Safari (da iOS 16.4 anche da altri browser che usano WebKit).

## Offline
Dopo il primo caricamento il service worker conserva l'app: calendario, inserimento e modifica di attività, pagamenti, report, obiettivi ed export funzionano senza rete. Gli aggiornamenti dell'app vengono scaricati alla prima apertura con rete.

## Dati
- Il database è **separato** tra Safari e l'app installata nella Home: usa sempre l'app installata.
- Safari può cancellare i dati dei siti non usati per settimane; per le app installate nella Home il rischio è minore, ma **fai backup regolari** (Impostazioni → Scarica backup completo, poi salva su File/iCloud Drive).
- Navigazione privata: i dati non vengono conservati.

## Notifiche
- I promemoria di SkiWork sono **mostrati nell'app** (dashboard e Documenti e scadenze): non arrivano come notifiche quando l'app è chiusa.
- Su iOS una PWA può ricevere notifiche in background solo tramite Web Push, che richiede un server di invio. SkiWork non ha server, quindi **le notifiche in background non sono supportate** in questa versione.
- Alternativa gratuita per gli impegni: esporta il calendario in ICS e importalo in Apple Calendar, che gestisce i propri avvisi.

## Apple Calendar
- **Esporta** (Impostazioni → Esporta calendario) crea un file .ics da aprire su iPhone o Mac per aggiungere gli eventi ad Apple Calendar.
- **Importa** legge un file .ics: ogni evento crea un'attività "Altro" senza compenso; reimportare lo stesso file aggiorna gli eventi esistenti tramite UID e non crea duplicati. Le attività completate o cancellate non vengono modificate. Eventi ricorrenti (RRULE) e di giornata intera non sono importati.
- Non c'è sincronizzazione automatica bidirezionale: una PWA non può accedere al calendario di sistema. SkiWork resta la fonte di verità per i dati economici.
