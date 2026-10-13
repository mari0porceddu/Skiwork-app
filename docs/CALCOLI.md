# Regole di calcolo

Tutte le regole sono funzioni pure in `src/domain/` coperte da test in `tests/`.

## Importi e arrotondamenti
- Importi in **centesimi interi**, valuta EUR.
- Ogni calcolo che produce frazioni di centesimo arrotonda al centesimo "half away from zero" (2,5 → 3; −2,5 → −3), **per singola attività**. I totali sono somme di importi già arrotondati.
- Percentuali in punti base (1% = 100).

## Durate
- Ore di calendario locali. Se la fine è ≤ inizio, l'attività termina il giorno dopo (22:00–01:00 = 3 h). Inizio = fine non è ammesso.
- I cambi di ora legale non sono considerati (si usano gli orari scritti).
- **Minuti previsti** = durata − pausa non retribuita.
- **Minuti lavorati** = minuti effettivi inseriti, oppure i previsti se non indicati (attività completate).
- **Minuti riconosciuti** (solo tariffa oraria) = minuti lavorati arrotondati secondo la tariffa: nessuno, al più vicino, per eccesso o per difetto, a passi di N minuti.

## Compenso di una regola tariffaria
1. Base:
   - oraria: `arrotonda(minuti × tariffa / 60)`
   - per lezione: `tariffa × numero lezioni`
   - giornaliera: `tariffa × numero giornate` (registra una attività per giornata)
2. Maggiorazione = `arrotonda(base × % maggiorazione)`
3. Commissione = `arrotonda((base + maggiorazione) × % commissione)`
4. Netto = `base + maggiorazione − commissione − trattenuta fissa`

## Stati dell'attività
| Stato | Ore lavorate | Compenso previsto | Compenso maturato |
|---|---|---|---|
| Pianificato / Confermato | 0 | regola sui minuti previsti | 0 |
| Completato | minuti lavorati | regola sui minuti previsti | regola sui minuti riconosciuti + correzione manuale |
| Cancellato | 0 | 0 | compenso di cancellazione (se indicato) |

Gli impegni futuri non generano mai compensi maturati. Lo stato proposto nel form è "Completato" se l'orario di fine è già passato, altrimenti "Confermato", sempre modificabile.

## Tariffa applicabile
Stesso committente, valida alla data (`dal ≤ data ≤ al`). Si preferisce la tariffa specifica per la tipologia rispetto a quella generica, poi quella con inizio validità più recente. La tariffa scelta viene **copiata** nell'attività.

## Finanze
- **Fatturato**: documenti in stato "Emesso" con data di emissione nel periodo.
- **Incassato**: pagamenti registrati con data nel periodo. Un documento emesso non è un incasso.
- **Crediti residui** (alla fine del periodo): per ogni documento emesso fino a quella data, importo − pagamenti fino a quella data, se positivo.
- **% incassato** = incassato / fatturato del periodo.
- **Compenso medio orario** = maturato / ore lavorate.
- Rimborsi, spese e accantonamenti sono voci separate, mai sommate ai compensi.
- Stagione: dalle date configurabili in Impostazioni (predefinite 1/11 – 30/04).

## Documenti
Stato manuale fino all'emissione (da verificare, da preparare, da emettere, emesso). Dopo l'emissione: **pagato** se pagamenti ≥ importo; altrimenti **scaduto** se la scadenza è passata; altrimenti **parzialmente pagato** se c'è almeno un pagamento. Scadenza proposta = data di emissione + termine di pagamento del committente.

## Disponibilità e slot liberi
Per ogni giorno:
1. Regole del giorno: se esistono **eccezioni per quella data**, valgono solo quelle; altrimenti le regole ricorrenti del giorno della settimana, valide in quel periodo.
2. **Disponibile** = fasce "disponibile" ∪ "accetto lezioni" − "non disponibile".
3. **Occupato** = impegni confermati o completati, allargati del tempo di trasferimento (massimo tra quello del committente e quello predefinito).
4. **Proposte** = impegni "pianificati" (non confermati), anch'essi con trasferimento.
5. **Slot liberi** = fasce "accetto lezioni" (o, se assenti, "disponibile") − non disponibile − occupato − proposte, di durata ≥ minimo configurato.
6. Le attività cancellate non occupano tempo.

## Conflitti
Due impegni non cancellati sono in conflitto se si sovrappongono oppure se tra la fine del primo e l'inizio del secondo c'è meno del tempo di trasferimento richiesto. Il trasferimento è zero se il luogo è lo stesso.

## Obiettivi
- Valore attuale: solo dati consuntivi fino a oggi (attività completate, incassi registrati).
- Ritmo necessario = residuo / giorni rimanenti dopo oggi.
- Proiezione = (attuale / giorni trascorsi) × giorni totali.
- Data prevista = inizio + ⌈target / ritmo attuale⌉ − 1 giorno.

## Promemoria
Calcolati ogni volta dai dati, con ID derivati dall'oggetto (es. `overdue:<idDocumento>`), quindi riavvii, modifiche e importazioni non creano duplicati.

## Fisco (modulo parametrico, `src/domain/fiscal.ts`)
Il codice non contiene aliquote, coefficienti né scadenze fiscali: sono tutti **parametri** inseriti dall'utente, ciascuno con anno, ambito (tutti i committenti o uno specifico), valore, stato di verifica, fonte, date di validità e storico delle modifiche.

**Quando c'è una stima.** Solo se, per l'anno, sono *verificati* (con valore e fonte): base dei ricavi, coefficiente di redditività, aliquota dell'imposta sostitutiva, deducibilità dei contributi e, **per ogni committente** con ricavi o attivo, l'aliquota contributiva oppure lo stato "non applicabile" con motivazione. Un parametro "da verificare" o "scaduto" blocca la stima. Altrimenti l'app mostra "Stima fiscale non configurata: verifica i parametri con il commercialista." e l'elenco di cosa manca.

**Formula** (ogni passaggio è mostrato nel dettaglio del calcolo):
1. Ricavi = incassi dell'anno (cassa) oppure fatturato dell'anno, secondo il parametro.
2. Reddito lordo = ricavi × coefficiente.
3. Contributi = per ogni committente: (reddito lordo × ricavi del committente / ricavi totali) × aliquota del committente; + contributi fissi annui, se inseriti.
4. Reddito imponibile = reddito lordo − min(contributi versati, reddito lordo) se la deduzione è attiva, altrimenti reddito lordo.
5. Imposta = imponibile × aliquota. Saldo = imposta − acconti già versati. Acconti per l'anno dopo = imposta × % acconti.
6. Accantonamento suggerito = max(0, saldo) + acconti + contributi. Da accantonare ancora = suggerito − accantonato.
7. Liquidità residua stimata = incassato − spese − accantonamento suggerito.

Questa struttura è uno schema configurabile, non una certificazione: va confermata con il commercialista, e i parametri possono essere marcati "non applicabile".

**Simulazione.** Una sezione separata calcola la stessa formula con valori a scelta, non salvati e sempre etichettati come simulazione.

**Accantonamento manuale.** `% scelta × incassato dell'anno`, indicato come scelta prudenziale e non come calcolo fiscale; disponibile anche senza parametri.

**Scadenze fiscali.** Inserite dall'utente (nessun calendario fiscale predefinito); generano promemoria entro l'anticipo configurato.
