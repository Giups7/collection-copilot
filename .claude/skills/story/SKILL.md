---
name: story
description: Porta a termine una story Jira di Collection Copilot con i sotto-agenti (implementazione, review, aggiornamento Jira). Uso - /story KAN-xx
---

Story da lavorare: $ARGUMENTS

1. Leggi la story su Jira (getJiraIssue, view compact) e, se citata, la sezione Confluence pertinente. Se dipende da una decisione aperta (D-xx) o da una story non completata, fermati e dillo all'utente.
2. Sposta la story in In Progress (transizione 21) tramite `atlassian-scribe`.
3. Scrivi un brief autosufficiente: obiettivo, criteri di accettazione, modulo, schemi in `contracts/` coinvolti, cosa è fuori perimetro.
   - Se la story tocca `contracts/`, delega a `contracts-keeper`; altrimenti a `implementer`.
4. Delega la verifica a `reviewer` con lo stesso brief. Se il verdetto è DA CORREGGERE, rimanda i rilievi all'agente che ha scritto il codice. Al massimo due giri, poi riporta all'utente.
5. Mostra all'utente un riepilogo breve (cosa è stato fatto, test, punti aperti) e chiedi conferma per il commit.
6. Dopo il commit, tramite `atlassian-scribe`: commento sulla story con commit e file principali, transizione a Test (41).

Il push va fatto solo se l'utente lo chiede.
