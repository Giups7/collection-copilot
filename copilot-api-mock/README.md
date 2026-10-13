# copilot-api-mock

Mock a scenari della Copilot API v1 (`contracts/openapi/copilot-api.v1.yaml`): risposte fisse, nessun LLM, nessun database. Serve a sviluppare e testare le UI. TypeScript su Node >= 24 (esecuzione diretta dei `.ts`, nessuna build).

```
npm install
npm start          # http://localhost:8080  (PORT, MOCK_EVENT_DELAY_MS in ms tra gli eventi SSE, default 0)
npm test           # Vitest: ogni risposta ed evento SSE e validato con Ajv 2020 strict contro ../contracts/schemas
npm run typecheck
```

## Comportamento

- Auth: serve `Authorization: Bearer <qualunque>`, altrimenti 401. Errori in `application/problem+json`.
- Scenario: header `X-Mock-Scenario: <id>`; se assente, parola chiave nel messaggio; altrimenti `classifica`. Header sconosciuto: 400.
- Deterministico: requestId, conversationId e correlationId derivano da hash di messaggio + scenario + `Idempotency-Key` (+ conversationId); i timestamp vengono dallo scenario. `X-Correlation-Id` della richiesta, se presente, viene riusato.
- Stato solo in memoria: dopo un riavvio gli id precedenti danno 404.
- `GET /v1/copilot/data/ds-perf-1p` (paginato, size <= 200), file `f-20261013-001` (PDF) e `f-20261013-002` (XLSX), capabilities: vedi `fixtures/`.

## Scenari

`scenarios/<id>/scenario.json` (`id`, `description`, `keywords`, `result` conforme a copilot-result) e `events.jsonl` (eventi conformi a sse-event). Gli scenari vengono validati all'avvio. Nel codice non c'e logica per singolo scenario: sovrascrive solo requestId/conversationId/correlationId.

| id | parole chiave | esito |
|---|---|---|
| `classifica` (default) | classifica, chi va meglio, migliori, performa, ranking | ranking 1P, COMPLETED |
| `errore` | errore, non autorizzato, vietato | 403 perimetro, FAILED |
