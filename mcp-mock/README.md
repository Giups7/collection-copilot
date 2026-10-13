# mcp-mock

Server MCP mock (SDK ufficiale `@modelcontextprotocol/sdk`, transport Streamable HTTP) con i tool di analisi di Collection Copilot calcolati sul dataset sintetico che `analytics-engine` genera in memoria all'avvio (seed fisso). Nessuna autenticazione per ora (sara On-Behalf-Of con E8): ascolta solo su `127.0.0.1`.

```text
npm install
npm start          # http://127.0.0.1:8090/mcp
npm test           # Vitest (avvia il server su porta casuale, client MCP dell'SDK)
npm run typecheck
```

Variabili d'ambiente: `MCP_MOCK_PORT` (default 8090, 0 = casuale), `MCP_MOCK_ALLOWED_ORIGINS` (origini browser aggiuntive, separate da virgola), `MCP_MOCK_SEED` (default: seed di `analytics-engine`, 20261013; stesso seed = stesso dataset = stessi output).

## Endpoint

`POST /mcp` (JSON-RPC MCP, server stateless con risposte JSON). Altri metodi: 405; altri percorsi: 404. Protezione DNS rebinding: Host ammessi `127.0.0.1:<porta>` e `localhost:<porta>`; un Origin estraneo da 403 (le richieste senza Origin, cioe i client non browser, sono ammesse); corpo massimo 64 KiB (413).

## Tool (KAN-44)

`get_kpi_catalog`, `list_collectors`, `get_portfolio_summary`, `get_recovery_trend`, `get_portfolio_distribution`, `get_collector_performance`, `compare_collectors`, `rank_collectors_by_band`, `get_case_timeline`. Nessun tool controfattuale (D-42).

- Nomi, descrizioni e schemi vengono da `contracts/schemas/tools/` (`index.json`, `$defs.input`/`$defs.output`), letti all'avvio; in `tools/list` i `$ref` sono risolti in linea.
- Ogni input e validato con Ajv 2020 strict prima dell'esecuzione (errore MCP `isError` leggibile); ogni output e validato contro `$defs.output` (se non valido: errore del server). `meta` ha sempre `tool`, `asOf`, `scope` e `seed` del dataset.
- Calcoli: funzioni di `analytics-engine` (importato con percorso relativo, il type stripping di Node non lavora in `node_modules`). Indice per mix, intervalli e classifica passano dall'adattatore `src/tools/rank.ts`.
- Le aggregazioni di portafoglio (`get_portfolio_summary`, `get_recovery_trend`, `get_portfolio_distribution`) sono in `analytics-engine/src/portfolio.ts`; qui c'e solo l'adattamento.
- `compare_collectors`: lo schema di input non ha `minSample`, quindi la soglia di dati insufficienti e fissa a 30.
- `get_recovery_trend` attribuisce gli affidi al periodo di inizio affido (coorte), come lo scope.
- `get_case_timeline` accetta l'id pratica del dataset (es. `P000001`) e risponde con un riferimento pseudonimizzato `PR-...`; una pratica sconosciuta (anche `LE-76168` dell'esempio del contratto) da un errore leggibile.

## Provarlo con MCP Inspector

```text
npm start
npx @modelcontextprotocol/inspector
```

Nell'Inspector: Transport Type `Streamable HTTP`, URL `http://127.0.0.1:8090/mcp`, Connect, poi Tools > List Tools.
