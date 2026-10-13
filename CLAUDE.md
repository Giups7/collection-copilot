# Collection Copilot — guida per Claude Code

Assistente AI di analisi in sola lettura per Collection / NPL. Il codice calcola, l'AI spiega e suggerisce, l'utente decide. Nessuna creazione di lotti o allocazione (rimandata a "Fase futura").

## Dove stanno le cose

- Analisi (ATF): Confluence, spazio COLLAI, sito giups7.atlassian.net, cloudId `cfd70809-cef8-419e-b240-8a124797ebde`. Pagina madre 655361; decision log 786469; tool 917509; KPI e metodologia 688146; UI e blocchi 163976; Copilot API 655379; agente 393246; note di rilascio 1605633; manuale d'uso 1638401.
- Backlog: Jira, progetto KAN. Epic KAN-1…11 (E1…E11), story KAN-12…62. Transizioni: To Do 11, In Progress 21, Ready to merge 31, Test 41, Done 51.
- Codice: questo repo, https://github.com/Giups7/collection-copilot (`main`). Moduli e stato nel `README.md`.

## Regole del progetto

- Ogni cambio di strada, priorità o decisione si riporta subito su Atlassian: voce D-xx nel decision log, commenti/transizioni sulle issue Jira coinvolte, aggiornamento delle pagine ATF toccate. Mappa dei contenuti: `.claude/atlassian-map.md` (consultarla invece di ricercare; aggiornarla quando cambia).

- Contract-first: `contracts/` è l'unica fonte di verità. Nessun modulo inventa campi; se serve un campo nuovo si cambia prima il contratto (regole di evoluzione in `contracts/README.md`).
- Dopo ogni modifica ai contratti: `npm run check` in `contracts/` deve passare.
- Determinismo: seed fissi, nessun numero inventato dall'LLM (grounding check).
- Stack (D-14): da decidere; proposta TypeScript/Node.
- Commit: niente identità git globale, usare `git -c user.name=giups7 -c user.email=giups7@hotmail.it commit ...`. Push solo su richiesta.

## Flusso di lavoro con gli agenti

Il main agent pianifica, decide, delega e tiene aggiornati Jira e Confluence. Il lavoro operativo va ai sotto-agenti in `.claude/agents/`:

| Agente | Modello | Quando |
|---|---|---|
| `implementer` | sonnet | implementare una story in un modulo, con test |
| `contracts-keeper` | sonnet | modificare o estendere i contratti |
| `reviewer` | sonnet | rivedere un diff rispetto a contratti e ATF (sola lettura) |
| `atlassian-scribe` | haiku | commenti, transizioni Jira, piccoli aggiornamenti Confluence |
| `docs-writer` | sonnet | note di rilascio e manuale d'uso su Confluence (pagine 14 e 15) |

Per una story completa: `/story KAN-xx`.

Per risparmiare token: i sotto-agenti ricevono un brief autosufficiente (story, file, criteri) e restituiscono un report breve (file toccati, esito test, punti aperti), non il contenuto dei file.
