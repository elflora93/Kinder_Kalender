# Kinder-Kalender

Ein Kalender für Vorschulkinder: Wer bringt in die Kita, wer holt ab, was ist am Nachmittag, wer bringt ins Bett – mit Fotos, Symbolen und einer Zeitleiste mit Tageszeit-Bildern.

- `index.html` – die Web-App (läuft über GitHub Pages)
- `supabase/setup.sql` – legt die Tabelle in Supabase an (einmal im SQL Editor ausführen)
- `supabase/functions/google-kalender/index.ts` – Server-Funktion, die den Google-Kalender „Nora“ liest (Secret `ICAL_URL` = private iCal-Adresse)

Die Daten liegen in Supabase. Jedes Gerät meldet sich einmal mit dem Familien-Konto an.
Termine aus dem Google-Kalender „Nora“ werden über Stichwörter Personen und Symbolen zugeordnet.
Geplant: Anzeige auf einem Wand-Monitor.
