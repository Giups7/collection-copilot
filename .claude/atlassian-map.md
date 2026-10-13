# Mappa Atlassian – Collection Copilot

- Data: 2026-10-13
- cloudId: `cfd70809-cef8-419e-b240-8a124797ebde`
- URL base: https://giups7.atlassian.net
- Confluence space: COLLAI (spaceId 622594), pagina madre 655361
- Jira progetto: KAN (62 issue: 11 epic + 51 figli)
- Transizioni Jira: To Do 11, In Progress 21, Ready to merge 31, Test 41, Done 51

## Confluence – pagine (spazio COLLAI)

Colonna "padre": `–` = figlia diretta di 655361; `1081346` = figlia di "Fase futura".
Fuori albero: 622770 "Collection Copilot AI Home" (home dello spazio, template vuoto).

| ID | Titolo | Padre | Contenuto |
|---|---|---|---|
| 655361 | Collection Copilot AI – Analisi Tecnico-Funzionale | – | Indice del documento: scopo, struttura, convenzioni, storico revisioni (v0.3, perimetro sola lettura) |
| 688129 | 01 – Panoramica e glossario | – | Contesto, obiettivo, glossario del dominio Collection/NPL |
| 720898 | 02 – Attori e requisiti | – | Attori (analista, responsabile affidamenti, auditor, LLM) e requisiti |
| 753665 | 03 – Architettura | – | Vista d'insieme: client, Copilot API v1, AI Orchestrator, Microsoft Foundry |
| 688146 | 04 – KPI e metodologia statistica | – | Unità di analisi (affido), KPI, indice corretto per mix, soglie |
| 917509 | 05 – Catalogo tool MCP (analisi) | – | Tool MCP di analisi in sola lettura, convenzioni, contratto JSON Schema |
| 1245185 | 06 – Modello dati e fonti | – | Dataset degli affidi dalle tabelle QINETIC_NPL su DEV (ruoli da verificare) |
| 819201 | 07 – Sicurezza, privacy e AI governance | – | Sola lettura, nessun SQL libero, identità propagata (OBO), privacy LLM |
| 1277953 | 08 – Test e criteri di accettazione | – | Strategia di test per KPI, classifiche, insight, dati sintetici e reali |
| 786469 | 09 – Decision log e questioni aperte | – | Registro decisioni D-xx (vedi sezione Decisioni) |
| 884738 | 10 – Autenticazione (Microsoft Entra ID) e accesso al modello | – | Login Entra ID aziendale, LLM su Foundry, nessuna API key utente (D-23, D-24) |
| 163976 | 11 – UI e contratto dei blocchi (contract-first) | – | Contratto blocchi UI e approccio contract-first (mock → reale) |
| 655379 | 12 – Contratto Copilot API e disaccoppiamento | – | Copilot API v1 versionata (OpenAPI/JSON Schema), UI intercambiabili, mock |
| 393246 | 13 – Configurazione, valutazione e miglioramento dell'agente | – | Agente configurato (no fine-tuning), agent-pack, golden set, valutazione |
| 1605633 | 14 Note di rilascio | – | Note di rilascio per data/commit (es. 2026-10-13: contratti v1, mock) |
| 1638401 | 15 Manuale d'uso | – | Uso del mock della Copilot API (Node >= 24, copilot-api-mock/) |
| 1081346 | Fase futura – Allocazione lotti (sospesa) | – | Allocazione lotti sospesa dal 2026-10-13 (D-27); decisioni D-01…D-25 |
| 131074 | Allocazione – Motore di allocazione parametrico | 1081346 | Motore deterministico di assegnazione pratiche a recuperatori con percentuali utente |
| 786434 | Allocazione – Catalogo tool MCP (versione con lotti) | 1081346 | Tool MCP per lotti: tipizzazione, identità, paginazione |
| 786451 | Allocazione – Regole di candidatura e integrazioni | 1081346 | Regole di candidatura e tabelle di dominio QINETIC_NPL (ruoli non verificati) |
| 851969 | Allocazione – Test e criteri di accettazione | 1081346 | Test per il motore di allocazione e l'API lotti |

## Decision log (pagina 786469)

Stato: **decisa** = DECISO; **aperta** = tutti gli altri (stato originale tra parentesi).
Le decisioni D-01…D-12, D-16…D-18, D-20…D-22, D-25 non sono nel log: sono nella pagina 1081346 (sospese).

| ID | Decisione | Stato |
|---|---|---|
| D-13 | Modello e provider LLM: Microsoft Foundry nel tenant, data zone UE; proposta Claude Opus 5.5 | aperta (PARZIALE) |
| D-14 | Stack di Orchestrator e MCP Server (TypeScript/Node o Java; MCP via Streamable HTTP) | aperta (DA CONFERMARE) |
| D-15 | Persistenza audit e cache giornaliera del dataset affidi | aperta (DA CONFERMARE) |
| D-19 | Dati personali con LLM (GDPR, DPIA): incontro DPO/Compliance, nel frattempo solo aggregati | aperta (BLOCCANTE) |
| D-23 | Autenticazione utenti: Entra ID aziendale, App Roles, OBO verso MCP Server | decisa |
| D-24 | Accesso per i clienti esterni | aperta (RINVIATO) |
| D-26 | Approccio di sviluppo: contract-first con MCP Server mock | decisa |
| D-27 | Perimetro prototipo: solo analisi in sola lettura; allocazione lotti sospesa | decisa |
| D-28 | Regole di costruzione del dataset affidi (workshop con referente funzionale) | aperta (BLOCCANTE) |
| D-29 | KPI di riferimento per classifiche: RR_90 (recovery rate 90 giorni) | aperta (DA CONFERMARE) |
| D-30 | Dimensioni per la correzione del mix: fascia × prodotto × classe di esposizione | aperta (DA CONFERMARE) |
| D-31 | Volume minimo per un giudizio: 30 affidi per recuperatore e fascia | aperta (DA CONFERMARE) |
| D-32 | Periodo di default: ultimi 12 mesi di inizio affido | aperta (DA CONFERMARE) |
| D-33 | Soglie anomalie: mediana 6 mesi ± 3 MAD; rapportino mancante oltre N giorni | aperta (DA CONFERMARE) |
| D-34 | Classi di esposizione: < 5k, 5–20k, > 20k | aperta (DA CONFERMARE) |
| D-35 | Fonte delle provvigioni (costo-efficacia) | aperta (DA VERIFICARE) |
| D-36 | Riferimento senza recuperatore (regolarizzazione spontanea) | aperta (DA VERIFICARE) |
| D-37 | Disaccoppiamento UI / motore AI: Copilot API versionata, mock per le UI | decisa |
| D-38 | Architettura agente: un solo agente, agent-pack versionato, nessun fine-tuning | aperta (DA CONFERMARE) |
| D-39 | Standard e policy aziendali (OpenAPI, linguaggi, repo, CI, container, naming) | aperta (DA VERIFICARE) |
| D-40 | Priorità alla catena reale (2026-10-13) | decisa |
| D-41 | Accesso all'LLM con sign-in Microsoft (2026-10-13) | aperta (DA VERIFICARE) |
| D-42 | Eliminata la simulazione di riassegnazione "e se" (tool simulate_reassignment e blocco whatIf rimossi); prodotto descrittivo (2026-10-13) | decisa |
| D-43 | Pari merito in classifica per rango di separazione (rango = 1 + n. recuperatori con limite inferiore IC sopra il proprio limite superiore); non più "intervalli sovrapposti" (2026-10-13) | decisa |
| D-44 | Previsione incassi (KAN-42) calibrata e probabilistica: intervallo 80% con copertura misurata nel backtest, mai un numero secco; se la calibrazione non regge non viene mostrata; solo affidi realmente aperti (2026-10-13) | decisa |

## Jira – progetto KAN

Formato: chiave | titolo | stato. Epic padre indicata nella sezione.

### KAN-1 – E1 Decisioni e prerequisiti (To Do)

| Chiave | Titolo | Stato |
|---|---|---|
| KAN-12 | Workshop regole di costruzione del dataset affidi (D-28) | To Do |
| KAN-13 | Parere DPO/Compliance su dati personali e LLM (D-19) | To Do |
| KAN-14 | Raccolta policy e standard aziendali (D-39) | To Do |
| KAN-15 | Scelta dello stack di Orchestrator e MCP Server (D-14) | To Do |
| KAN-16 | Scelta del modello su Microsoft Foundry e provisioning risorsa (D-13) | To Do |
| KAN-17 | Conferma parametri metodologici KPI (D-29 … D-34) | To Do |
| KAN-18 | Verifica fonte provvigioni e gruppo di confronto (D-35, D-36) | To Do |

### KAN-2 – E2 Contratti (Copilot API, blocchi, tool MCP) (In Progress)

| Chiave | Titolo | Stato |
|---|---|---|
| KAN-19 | OpenAPI della Copilot API v1 | Test |
| KAN-20 | JSON Schema dei blocchi e degli eventi SSE | Test |
| KAN-21 | Schemi input/output dei tool MCP di analisi | Test |
| KAN-22 | Generazione dei tipi da contratti per client e server | To Do |
| KAN-23 | Validazione dei contratti e controllo compatibilità in CI | To Do |

### KAN-3 – E3 Mock Copilot API (In Progress)

| Chiave | Titolo | Stato |
|---|---|---|
| KAN-24 | Server mock della Copilot API a scenari | Test |
| KAN-25 | Scenari base del mock Copilot API | In Progress |
| KAN-26 | Streaming configurabile e profilo di avvio "ui" | In Progress |

### KAN-4 – E4 Identità Microsoft Entra ID (To Do)

| Chiave | Titolo | Stato |
|---|---|---|
| KAN-27 | Registrazioni applicative Entra ID e App Roles | To Do |
| KAN-28 | Validazione token Entra ID su Orchestrator e MCP Server | To Do |
| KAN-29 | Flusso On-Behalf-Of da Orchestrator a MCP Server e perimetro utente | To Do |

### KAN-5 – E5 UI Angular (collection-fe-ai) (To Do)

| Chiave | Titolo | Stato |
|---|---|---|
| KAN-30 | Login MSAL e interceptor del token in Angular | To Do |
| KAN-31 | Chat con streaming SSE e prompt suggeriti | To Do |
| KAN-32 | Block renderer e blocchi base (kpi, chart, table, timeline, file) | To Do |
| KAN-33 | Blocchi di analisi: heatmap, ranking, insightList | To Do |
| KAN-34 | Layout chat + area di lavoro e feedback sulle risposte | To Do |

### KAN-6 – E6 Motore statistico (analytics-engine) (To Do)

| Chiave | Titolo | Stato |
|---|---|---|
| KAN-35 | Generatore del dataset sintetico di affidi (seed fisso) | To Do |
| KAN-36 | Calcolo KPI del catalogo | To Do |
| KAN-37 | Indice corretto per mix e intervalli di confidenza | To Do |
| KAN-38 | Classifica per fascia con etichette e pari merito | To Do |
| KAN-39 | Curve di recupero e matrice di migrazione tra fasce | To Do |
| KAN-40 | Generatore di insight deterministici | To Do |
| KAN-41 | Rilevazione anomalie e controlli di qualità dati | To Do |
| KAN-42 | Previsione incassi con backtest | To Do |
| KAN-43 | Costo-efficacia per recuperatore e fascia | To Do |

### KAN-7 – E7 MCP Server mock (To Do)

| Chiave | Titolo | Stato |
|---|---|---|
| KAN-44 | MCP Server mock: tool di portafoglio e performance | To Do |
| KAN-45 | MCP Server mock: tool di insight, previsione e qualità dati | To Do |
| KAN-46 | Generazione report PDF/XLSX (generate_report) | To Do |
| KAN-47 | Profilo di avvio "agent" (Orchestrator + MCP mock) | To Do |

### KAN-8 – E8 Orchestrator e agente (To Do)

| Chiave | Titolo | Stato |
|---|---|---|
| KAN-48 | Copilot API reale nell'Orchestrator | To Do |
| KAN-49 | Integrazione con Microsoft Foundry e ciclo di chiamata dei tool | To Do |
| KAN-50 | Grounding check dei numeri citati e controllo delle policy | To Do |
| KAN-51 | agent-pack v0.1: istruzioni, conoscenza, esempi, policy | To Do |
| KAN-52 | Audit delle richieste | To Do |

### KAN-9 – E9 Valutazione dell'agente (To Do)

| Chiave | Titolo | Stato |
|---|---|---|
| KAN-53 | Golden set di 50+ domande di riferimento | To Do |
| KAN-54 | Script di valutazione automatica dell'agente | To Do |
| KAN-55 | Registrazione e riproduzione delle risposte LLM per i test in CI | To Do |
| KAN-56 | Soglie di accettazione in CI e griglia di revisione esperta | To Do |

### KAN-10 – E10 MCP Server reale su Oracle DEV (To Do)

| Chiave | Titolo | Stato |
|---|---|---|
| KAN-57 | Esplorazione delle tabelle QINETIC_NPL su DEV | To Do |
| KAN-58 | Costruzione del dataset affidi da Oracle DEV con cache giornaliera | To Do |
| KAN-59 | MCP Server reale: tool su dati DEV e controllo del perimetro | To Do |
| KAN-60 | Riconciliazione con i report esistenti | To Do |

### KAN-11 – E11 Demo contest (To Do)

| Chiave | Titolo | Stato |
|---|---|---|
| KAN-61 | Copione e scenari della demo | To Do |
| KAN-62 | Materiale di presentazione per il contest | To Do |

## Come aggiornare questa mappa
1. Rieseguire le ricerche (CQL `ancestor = 655361` su COLLAI; JQL `project = KAN ORDER BY key`) e rigenerare le tabelle.
2. Cambiare la data di intestazione e annotare le differenze di stato o di pagina rispetto alla versione precedente.
