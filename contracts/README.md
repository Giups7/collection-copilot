# @collection-copilot/contracts

Contratti di Collection Copilot: l'unica fonte di verità tra client (UI), motore AI (Orchestrator) e MCP Server.

| Cosa | Dove | Formato |
|---|---|---|
| Copilot API v1 (client ↔ motore AI) | `openapi/copilot-api.v1.yaml` | OpenAPI 3.1 |
| Corpi di richiesta e risposta dell'API | `schemas/api/` | JSON Schema 2020-12 |
| Blocchi mostrati dalla UI | `schemas/blocks/` (unione in `block.schema.json`) | JSON Schema 2020-12 |
| Eventi dello stream SSE | `schemas/events/sse-event.schema.json` | JSON Schema 2020-12 |
| Tool MCP di analisi (motore AI ↔ MCP Server) | `schemas/tools/<tool>.schema.json` (`$defs.input`, `$defs.output`) e catalogo `schemas/tools/index.json` | JSON Schema 2020-12 |
| Definizioni comuni (scope, metadati, errori) | `schemas/common/` | JSON Schema 2020-12 |
| Esempi validi | `examples/` | JSON / JSONL |
| Esempi che devono essere rifiutati | `examples-invalid/` | JSON / JSONL |

Riferimenti funzionali: ATF su Confluence, spazio COLLAI, pagine 05 (tool), 11 (blocchi) e 12 (Copilot API).

## Comandi

```bash
npm install
npm run check      # lint OpenAPI + validazione schemi ed esempi
npm run validate   # solo schemi ed esempi
npm run bundle     # OpenAPI in un unico file: dist/copilot-api.v1.bundled.yaml
```

`npm run validate` verifica che:

- tutti gli schemi compilino in modalità strict e abbiano `$id` coerente con il percorso;
- gli esempi in `examples/` siano validi e quelli in `examples-invalid/` vengano rifiutati;
- catalogo dei tool e file di schema coincidano, e ogni tool abbia almeno un esempio;
- ogni tipo di blocco abbia almeno un esempio.

## Convenzioni per gli esempi

Lo schema di riferimento si ricava dal percorso:

| Percorso | Schema |
|---|---|
| `examples/api/<nome>[.<variante>].json` | `schemas/api/<nome>.schema.json` |
| `examples/blocks/*.json` | `schemas/blocks/block.schema.json` |
| `examples/events/*.jsonl` (una riga per evento) | `schemas/events/sse-event.schema.json` |
| `examples/tools/<tool>.input.json` / `.output.json` | `schemas/tools/<tool>.schema.json#/$defs/input` / `output` |

## Regole di evoluzione (v1)

- Ammesse solo modifiche compatibili: nuovi campi opzionali, nuovi valori dove i client li ignorano, nuovi tipi di blocco.
- Vietato rimuovere campi, renderli obbligatori o cambiarne il significato: serve una v2.
- I client devono ignorare (o mostrare con un fallback) i tipi di blocco che non conoscono.
- Ogni modifica a uno schema va accompagnata da un esempio aggiornato.
- D-42: rimossi prima del primo rilascio il tool simulate_reassignment e il blocco whatIf (eccezione alla regola, v1 senza consumatori esterni).
