# Salvataggio su Google Drive: configurazione

L'app usa l'accesso OAuth di Google direttamente dal browser (nessun server, nessun segreto).
Serve un ID client OAuth gratuito, creato una volta:

1. Su https://console.cloud.google.com crea un progetto (es. "SkiWork").
2. "API e servizi" → "Libreria": abilita **Google Drive API**.
3. "Google Auth Platform" (schermata di consenso OAuth): nome app, email di assistenza, pubblico **Esterno**.
   In "Accesso ai dati" aggiungi l'ambito `https://www.googleapis.com/auth/drive.appdata`.
   In "Pubblico" pubblica l'app ("In produzione"), altrimenti possono accedere solo gli utenti di test indicati.
4. "Client" → crea un client di tipo **Applicazione web**:
   - Origini JavaScript autorizzate: `https://<utente>.github.io`
   - URI di reindirizzamento autorizzati: l'indirizzo esatto dell'app, con la barra finale (es. `https://<utente>.github.io/<repo>/`).
5. Copia l'**ID client** (termina con `.apps.googleusercontent.com`) in `src/config.ts`. Non serve il client secret.

L'ambito `drive.appdata` dà accesso solo a una cartella nascosta riservata all'app, non ai file dell'utente.
Finché l'app non è verificata da Google, al primo accesso può comparire l'avviso "Google non ha verificato questa app".
