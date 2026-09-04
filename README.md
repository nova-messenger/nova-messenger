# ⚡ AETHER — Next-Gen Realtime Messenger
> *L'alternativa moderna a WhatsApp: Zero numeri di telefono. Massima privacy. Chat, Gruppi, Chiamate e Videochiamate WebRTC, Storie 24h, Meme Generator e Note Vocali.*

---

## 🌟 Caratteristiche Principali

- 📱 **Zero Numeri di Telefono**: Non serve condividere il proprio numero di cellulare. L'accesso avviene tramite **Email e Password** con un nome utente univoco (es. `@andrea`).
- ✉️ **Verifica Email con Codice OTP**: Al momento della registrazione viene generato un codice OTP di verifica a 6 cifre con scadenza temporale. Include un comodo simulatore visivo a schermo per test locali istantanei.
- 🔍 **Ricerca Contatti Istantanea**: Trova chiunque in tempo reale cercando per:
  - `@username` (es. digiti `@andrea` e appare subito)
  - Indirizzo Email (es. `andrea@email.com`)
  - Nome e Cognome (es. `Andrea Lazzaro`)
- 💬 **Chat 1-a-1 e Gruppi**:
  - Messaggistica istantanea bidirezionale via **WebSocket duplex** nativo RFC 6455.
  - Creazione gruppi con nome, icona e gestione membri.
  - Ricevute di lettura con spunte di stato (✓ inviato, ✓✓ letto).
  - Indicatore di digitazione in tempo reale (*"Andrea sta scrivendo..."*).
  - Cancellazione messaggi (*Elimina per tutti*).
  - Reazioni rapide con emoji (❤️, 👍, 😂, 😮, 😢, 🔥).
  - Risposta con citazione del messaggio.
- 📹 **Chiamate e Videochiamate WebRTC HD**:
  - Connessioni dirette peer-to-peer ad altissima definizione e bassissima latenza.
  - Suonerie e toni di chiamata generati proceduralmente via **Web Audio API** (nessun file esterno pesante che rischia di fallire).
  - Finestra di chiamata con controlli per disattivare microfono, disattivare telecamera, picture-in-picture e riaggancio.
- 🎭 **Generatore di Meme Integrato**:
  - Seleziona un template tra i meme più famosi (Drake, Distracted Boyfriend, Two Buttons, Galaxy Brain) oppure carica un'immagine.
  - Scrivi testo superiore e inferiore: il rendering su Canvas HTML5 genera un meme in stile classico e lo invia direttamente in chat!
- ⭕ **Storie / Stati a 24 Ore**:
  - Pubblica stati testuali con sfondi gradienti moderni o foto con didascalia.
  - Scadenza automatica a 24 ore.
  - Player a barre di progresso temporizzate stile Instagram/WhatsApp con pausa al tocco e possibilità di **rispondere direttamente alla storia in chat privata**.
- 🎤 **Note Vocali con Player Audio**:
  - Registrazione microfonica nativa tramite `MediaRecorder` API con visualizzazione del timer di registrazione e invio istantaneo.
- 🎨 **Design WhatsApp Ultra-Dark & Glassmorphism**:
  - Interfaccia scura OLED profonda con accenti smeraldo e ciano.
  - 100% responsiva (layout a due pannelli su Desktop, navigazione fluida su Mobile).

---

## 🛠️ Architettura e Tecnologie

- **Runtime Backend**: Node.js v22 (utilizza le nuove API native ad altissime prestazioni).
- **Database**: **SQLite** (`node:sqlite`) con modalità WAL (*Write-Ahead Logging*) abilitata. Zero configurazioni, zero installazioni complesse di server database esterni, salvataggio su file compatto e resiliente `aether.db`.
- **Signaling & Real-Time**: WebSocket Server nativo conforme RFC 6455 integrato direttamente in Node.js (zero dipendenze npm pesanti).
- **Media & File Storage**: Salvataggio locale in `public/uploads` con supporto Base64 e MIME parsing.
- **Frontend**: Single Page Application (SPA) in Vanilla ES6+ e CSS3 custom glassmorphic senza build step lenti o fragili.

---

## 🚀 Come Avviare Aether in Locale

### Opzione 1: Script Diretto (Consigliato)
Nel terminale, all'interno della cartella del progetto:
```bash
./start.sh
```
oppure direttamente con Node:
```bash
node server.js
```

Apri il browser all'indirizzo:
👉 **[http://localhost:3000](http://localhost:3000)**

### Opzione 2: Con Docker
```bash
docker build -t aether-messenger .
docker run -p 3000:3000 -v $(pwd)/data:/app/data aether-messenger
```

oppure con Docker Compose:
```bash
docker-compose up -d
```

---

## ☁️ Guida Completa all'Hosting (Dove Pubblicarla)

Aether è stata progettata come un unico servizio autonomo (Single Container / Single Process) che include server HTTP, WebSocket e database SQLite su volume persistente. Questo la rende la soluzione ideale e più economica per l'hosting cloud.

### 1. Render.com (Gratuito o Starter $7/mese) — Consigliato per Semplicità
1. Crea un account su [Render.com](https://render.com).
2. Crea un nuovo **Web Service** e collega il tuo repository GitHub/GitLab contenente il codice.
3. Seleziona Runtime **Node** o **Docker**.
4. Imposta come comando di avvio: `node server.js`.
5. Seleziona la porta `3000`.
6. (*Consigliato*) Aggiungi un **Persistent Disk** montato su `/app/data` (così il database SQLite `aether.db` e i file caricati non vengono persi ai riavvii).
7. Clicca su **Deploy**: in 2 minuti riceverai un URL pubblico HTTPS (es. `https://aether-chat.onrender.com`) con certificato SSL e WebSockets funzionanti!

### 2. Railway.app (Facilissimo con 1 Click)
1. Vai su [Railway.app](https://railway.app).
2. Clicca su **New Project** -> **Deploy from GitHub repo**.
3. Railway rileverà automaticamente il `Dockerfile` e avvierà il container.
4. Aggiungi un volume montato su `/app/data`.
5. Railway ti genererà un dominio pubblico HTTPS con supporto WebSockets e WebRTC.

### 3. Fly.io (Super Veloce e Globale)
1. Installa la CLI di flyctl (`curl -L https://fly.io/install.sh | sh`).
2. Nella cartella del progetto lancia:
   ```bash
   fly launch
   fly volumes create aether_data --size 1
   fly deploy
   ```
3. L'app sarà subito online in CDN globale a bassissima latenza.

### 4. VPS Linux (Ubuntu / Debian con Nginx & PM2)
Se disponi di una VPS (DigitalOcean, Hetzner, AWS, Linode):
1. Clona il progetto sul server:
   ```bash
   git clone <tuo-repo> /var/www/aether
   cd /var/www/aether
   ```
2. Installa PM2 e avvia l'app:
   ```bash
   npm install -g pm2
   pm2 start server.js --name "aether"
   pm2 startup
   pm2 save
   ```
3. Configura Nginx come reverse proxy per HTTP e WebSockets:
   ```nginx
   server {
       server_name chat.tuodominio.com;

       location / {
           proxy_pass http://127.0.0.1:3000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection "upgrade";
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
       }
   }
   ```
4. Genera il certificato SSL gratuito con Certbot:
   ```bash
   certbot --nginx -d chat.tuodominio.com
   ```

---

## 🔒 Variabili d'Ambiente Opzionali

Puoi personalizzare il comportamento di Aether tramite file `.env` o variabili d'ambiente di sistema:

| Variabile | Default | Descrizione |
|---|---|---|
| `PORT` | `3000` | Porta su cui ascolta il server HTTP e WebSocket |
| `HOST` | `0.0.0.0` | Host su cui fare il bind (tutte le interfacce di rete) |
| `DB_PATH` | `./aether.db` | Percorso del file database SQLite |

---

## 💡 Note di Utilizzo Locale
- **Simulatore Email OTP**: Quando crei un account o richiedi un nuovo codice di verifica, il codice a 6 cifre viene visualizzato sia nei log della console di Node, sia direttamente nella schermata con un comodo banner verde e il pulsante *"Inserisci Subito"*, per velocizzare al massimo i tuoi test senza bisogno di attendere email reali!
- Per testare una videochiamata tra due utenti in locale, apri due schede o finestre del browser (una normale e una in incognito) e crea due account diversi (es. `@andrea` e `@samuele`), poi avvia la chat e premi il pulsante 📹 Video!
