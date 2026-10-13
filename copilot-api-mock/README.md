# copilot-api-mock

Mock a scenari della Copilot API v1 (`contracts/openapi/copilot-api.v1.yaml`): risposte fisse, nessun LLM, nessun database. Serve a sviluppare e testare le UI.

**Prerequisito: Node >= 24** (esecuzione diretta dei `.ts`, nessuna build).

```
npm install
npm run ui         # profilo ui: http://localhost:8080, CORS attivo (http://localhost:4200), ritardo di 300 ms tra gli eventi
npm start          # mock "nudo": nessun CORS, nessun ritardo (porta 8080)
npm test           # Vitest: ogni risposta ed evento SSE e validato con Ajv 2020 strict contro ../contracts/schemas
npm run typecheck
```

`npm run ui` e `npm start` sono i due modi per avviare il mock; il resto della configurazione e opzionale (vedi "Configurazione").

## Comportamento

- Auth: serve `Authorization: Bearer <qualunque>`, altrimenti 401. Errori in `application/problem+json`.
- Scenario: header `X-Mock-Scenario: <id>`; se assente, parola chiave nel messaggio (se ne corrispondono piu di una vince la piu lunga, quindi `errore temporaneo` batte `errore`); altrimenti `classifica`. Header sconosciuto: 400.
- Deterministico: requestId, conversationId e correlationId derivano da hash di messaggio + scenario + `Idempotency-Key` (+ conversationId); i timestamp vengono dallo scenario. `X-Correlation-Id` della richiesta, se presente, viene riusato.
- **Stato solo in memoria**: le richieste e le conversazioni vivono nel processo. Dopo un riavvio i requestId (e i conversationId) precedenti danno 404; con gli stessi input il mock rigenera pero gli stessi id, quindi basta rifare la richiesta.
- Capabilities: `fixtures/capabilities.json`.

## Scenari

Ogni scenario e una cartella `scenarios/<id>/`:

- `scenario.json`: `id`, `description`, `keywords`, `result` (copilot-result completo), opzionali `streaming` e `files`;
- `events.jsonl`: gli eventi SSE (sse-event);
- `data/<dataSourceId>.json`: righe (`{ "rows": [...] }`) servite da `GET /v1/copilot/data/{dataSourceId}` per i blocchi `table` dello scenario;
- `files` in `scenario.json`: `{ fileId, format, name }` dei file serviti da `GET /v1/copilot/files/{fileId}` per i blocchi `file` dello scenario (PDF/XLSX minimali e deterministici).

Data source e file appartengono allo scenario che li usa, non a fixture globali: gli id devono essere unici tra scenari. Nel codice non c'e logica per singolo scenario: sovrascrive solo requestId/conversationId/correlationId.

All'avvio ogni scenario e validato contro gli schemi e controllato per coerenza: blocchi degli eventi = `result.blocks`, `message.delta` concatenati = `result.message`, `seq` progressivi, `done.status` = `result.status`, ogni `dataSourceId` ha il suo file di dati con `totalRows` e colonne corrispondenti, ogni `fileId` e dichiarato e `sizeBytes` e la dimensione reale. Se qualcosa non torna il mock non parte.

| id | parole chiave | blocchi | cosa dimostra |
|---|---|---|---|
| `classifica` (default) | classifica, chi va meglio, migliori, chi performa, performa meglio, ranking | ranking, table | Classifica 1P (RR_90) con indici e intervalli; tabella di dettaglio paginata (`ds-perf-1p`) |
| `riepilogo` | riepilogo, portafoglio, quadro generale, situazione generale | kpi, table | KPI di portafoglio (affidi, esposizione, incassato, recovery rate, CURE_RATE, PAY_RATE con delta) e tabella per fascia 1P-5P (`ds-portafoglio-fasce`) |
| `incassi` | incassi, andamento, incassato, trend | chart | Incassi mensili degli ultimi 12 mesi contro i 12 precedenti (LINE, 2 serie) |
| `heatmap` | heatmap, mappa di calore, matrice, recuperatore per fascia | heatmap | Indice corretto per mix recuperatore x fascia, con celle `insufficient` (n < 30, valore null) |
| `dati-insufficienti` | dati insufficienti, pochi dati, campione, volume minimo, cribis | ranking | Classifica 2P con due recuperatori `INSUFFICIENT_DATA` senza indice e due pari merito (`ties`) |
| `insight` | insight, strategie, anomalie, consigli, suggerisci, migliorare | insightList, timeline | Insight e anomalie del codice (PERFORMANCE_GAP, TREND_DECLINE, CURVE_PLATEAU, ANOMALY_MISSING_REPORTS), storico di una pratica, strategie che citano gli id INS-xxx |
| `previsione` | previsione, prevedi, forecast, prossimi mesi, prossimi 3 mesi | chart | Storico + serie `forecast` con banda `ciLow`/`ciHigh` (nulli dove non applicabili) |
| `report` | report, pdf, excel, xlsx, esporta, scarica | file | Due blocchi file (PDF e XLSX) scaricabili da `/files/{fileId}` |
| `errore` | errore, non autorizzato, vietato, accesso negato, 403 | nessuno | Perimetro non autorizzato: 403, `retryable: false`, FAILED |
| `errore-temporaneo` | errore temporaneo, temporaneo, riprova, non disponibile, 503, timeout | nessuno | Servizio non disponibile: 503, `retryable: true`, FAILED; il client puo riprovare |

I prompt suggeriti in `fixtures/capabilities.json` arrivano agli scenari pertinenti (portafoglio, classifica, strategie, previsione, anomalie); un test lo verifica, insieme a parole chiave distinte e alla presenza di ogni tipo di blocco.

### Errori: perche SSE `error` + risultato FAILED

L'OpenAPI prevede due canali per gli errori: problem+json HTTP sulle chiamate (401/403/429 su `POST /requests`, 404 sulle risorse) e, per gli errori che avvengono durante l'elaborazione, l'evento SSE `error` (schema `problem`, con `retryable`) seguito da `done` con `status: FAILED`; `GET /requests/{id}` restituisce poi `status: FAILED` con `error`. Gli scenari devono avere eventi e risposta completa, quindi i due errori sono **asincroni**: `POST` risponde 202, l'evento `error` chiude lo stream e il risultato e FAILED.

- `errore` (403, `insufficient-scope`): perimetro rifiutato dopo l'accettazione della richiesta, `retryable: false`.
- `errore-temporaneo` (503, `service-unavailable`): guasto transitorio, `retryable: true`.

Il rifiuto sincrono (403/429 direttamente su `POST`) non e coperto da uno scenario, perche non produce un requestId, e quindi nemmeno eventi o risposta completa. I problem+json HTTP del mock (401, 400, 404, 405, 413) restano quelli generici.

## Streaming configurabile

- **Ritardo tra gli eventi**: globale con `MOCK_EVENT_DELAY_MS` (o l'opzione `eventDelayMs`), sovrascrivibile per scenario con `"streaming": { "delayMs": 500 }` in `scenario.json` (0 = nessun ritardo anche se il globale e attivo).
- **Interruzioni**: `MOCK_DROP_AFTER_EVENTS=N` (opzione `dropAfterEvents`) o `"streaming": { "dropAfterEvents": N }` nello scenario chiudono la connessione di colpo dopo N eventi, senza `done`. Succede solo al primo collegamento: una richiesta con `Last-Event-ID` riprende dall'evento successivo e arriva fino a `done`. Il risultato completo (`GET /requests/{id}`) resta sempre disponibile. Prova rapida:

  ```
  MOCK_DROP_AFTER_EVENTS=3 npm start      # PowerShell: $env:MOCK_DROP_AFTER_EVENTS=3; npm start
  curl -N -H "Authorization: Bearer x" http://localhost:8080/v1/copilot/requests/<id>/events      # cade dopo 3 eventi
  curl -N -H "Authorization: Bearer x" -H "Last-Event-ID: 2" http://localhost:8080/v1/copilot/requests/<id>/events
  ```

## CORS (fuori dal contratto)

Il contratto non definisce CORS: e un comodita del mock per sviluppare una UI su un'altra origine. Con CORS attivo:

- `OPTIONS` su qualunque percorso risponde 204 **prima** del controllo Bearer, con `Access-Control-Allow-Origin`, `Allow-Headers` (Authorization, Content-Type, Idempotency-Key, X-Correlation-Id, X-Mock-Scenario, Last-Event-ID), `Allow-Methods` (GET, POST, OPTIONS) e `Max-Age`;
- tutte le altre risposte (anche 401/404 e lo stream SSE) portano `Access-Control-Allow-Origin` e `Access-Control-Expose-Headers: X-Correlation-Id`.

Limiti: `MOCK_CORS_ORIGIN` accetta una sola origine (niente elenco, niente `Vary: Origin`). Inoltre `EventSource` del browser non puo inviare `Authorization`: la UI deve leggere lo stream SSE con `fetch` (e `Last-Event-ID` a mano per la ripresa).

E spento nel mock "nudo" (`npm start`) e acceso nel profilo `ui`.

## Configurazione

Le variabili d'ambiente hanno la precedenza sui default del profilo.

| variabile | default (`npm start`) | default (`npm run ui`) | significato |
|---|---|---|---|
| `PORT` | 8080 | 8080 | porta di ascolto |
| `MOCK_EVENT_DELAY_MS` | 0 | 300 | ritardo (ms) tra gli eventi SSE; sovrascrivibile per scenario |
| `MOCK_CORS` | false | true | abilita CORS (`1`/`true`/`yes`/`on`) |
| `MOCK_CORS_ORIGIN` | `http://localhost:4200` | `http://localhost:4200` | valore di `Access-Control-Allow-Origin` |
| `MOCK_DROP_AFTER_EVENTS` | (nessuna) | (nessuna) | chiude lo stream dopo N eventi al primo collegamento; sovrascrivibile per scenario |
| `MOCK_PROFILE` | | | `ui` equivale a `--profile ui` |

`npm run ui` e `node src/main.ts --profile ui` (funziona uguale su Windows, macOS e Linux). Nel codice le stesse impostazioni sono le opzioni di `createMockServer({ eventDelayMs, dropAfterEvents, cors, corsOrigin, scenariosDir, schemasDir })`.

## Altre risorse

`GET /v1/copilot/data/{dataSourceId}` (paginato, `size` <= 200, `sort`), `GET /v1/copilot/files/{fileId}`, `GET /v1/copilot/capabilities`, conversazioni, cancel e feedback.
