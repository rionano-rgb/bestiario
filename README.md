# Bestiario del Lusso

MVP Node-based per una micro web app luxury mobile-first accessibile da QR code.

## Cosa include

- esperienza personalizzata su `/bestiario/:token`
- anteprima live della card
- raccolta nome, email, azienda e consenso privacy
- card finale in SVG e PNG
- tracking eventi locale su file JSON
- dashboard interna su `/admin`
- export CSV
- QR SVG per ogni destinatario

## Avvio locale

```bash
npm run dev
```

Server di default: `http://localhost:3000`

## Password admin

Di default:

```bash
tailerdarden-2026
```

Per cambiarla:

```bash
BESTIARIO_ADMIN_PASSWORD="una-password-piu-forte" npm run dev
```

## Dati seed

I destinatari iniziali sono in `data/recipients.json`.

Durante l'uso, eventi e card vengono salvati in:

- `data/events.json`
- `data/cards.json`

## Route principali

- `/` indice demo
- `/bestiario/:token` esperienza
- `/bestiario/card/:cardId` card finale
- `/admin` dashboard interna
- `/privacy` informativa essenziale
- `/chi-ha-creato-il-ritratto` pagina sintetica Tailer Darden

## Nota tecnica

Il progetto usa un server Node leggero con storage locale su file JSON per l'ambiente locale.

Su Vercel preview, i file vengono inizializzati in `/tmp`, quindi l'esperienza è pubblicabile e testabile, ma la persistenza non va considerata definitiva. Per una versione reale e stabile conviene sostituire lo storage con Supabase, Airtable o altro backend persistente.
