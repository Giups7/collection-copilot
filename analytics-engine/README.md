# analytics-engine

Libreria TypeScript pura (nessun server, nessuna rete) con i calcoli deterministici di Collection Copilot. Sara usata dal mock MCP (E7) e dal server reale su Oracle. Node >= 24, esecuzione `.ts` con type stripping (stesse convenzioni di `copilot-api-mock/`).

```text
npm install
npm test          # Vitest
npm run typecheck # tsc --noEmit
npm run generate  # scrive data/affidi.json e data/generator-params.json  (opzioni: -- --seed N --out DIR)
```

`data/` e in `.gitignore` (il dataset pesa circa 7 MB): si rigenera a richiesta.

## KAN-35 - Dataset sintetico

`generateDataset(seed?)` (`src/generate.ts`): PRNG mulberry32 (`src/prng.ts`), mai `Math.random` ne data corrente; stesso seed, stesso dataset. Struttura = record di affido della pagina 04/06 (`idAffido`, `pratica`, `recuperatore`, `fasciaAffido`, `dataInizio`, `dataFine`, `esposizioneIniziale`, `segmento`, `incassi`, `esito`, `provvigioni`) piu `incassiSenzaAffido`. Default: 5 recuperatori, fasce 1P/2P/3P, 24 mesi (2024-10 .. 2026-09), 550 affidi al mese (circa 13.200 righe, durata per affido uniforme 120-240 giorni), `asOf` 2026-09-30.

I parametri "veri" sono in `GENERATOR_PARAMS` (`src/params.ts`, esportato e documentato, scritto anche in `data/generator-params.json`):

- `collectorEffect`: moltiplicatore vero sull'importo recuperato a parita di mix. FIDES 1.20 (+20%), TELECOM 0.85, CRIBIS 0.95, PHONICA e NOVARECO 1.0. Gli effetti di segmento (`classEffect`, `productEffect`) sono uguali per tutti; TELECOM riceve piu pratiche >20k (`classMix`), quindi il suo valore semplice e piu basso di quanto indichi l'indice corretto per mix.
- `anomaly`: PHONICA, fascia 1P, affidi iniziati a 2025-06, incassi x0.35.
- `collectorShare`: CRIBIS ha ~0,5% della fascia 3P (sotto 30 affidi: dati insufficienti).
- `dirty`: quantita esatte di dati sporchi, su affidi disgiunti: 20 senza `dataInizio`, 10 senza esposizione, 10 con esposizione negativa, 12 senza fascia, 25 con un incasso negativo, 15 conclusi senza `dataFine` (segnalati, non esclusi), 20 righe duplicate, 30 incassi senza affido.

- `EXPECTED_INDEX` / `expectedIndex()`: indice vero atteso per mix (effetto del recuperatore / media degli effetti sul benchmark di segmento, pesata per volume), complessivo e per fascia. E cio che KAN-37 deve ritrovare: FIDES 1.20 (1.20-1.21 per fascia, non esattamente il moltiplicatore 1.20 perche il benchmark include FIDES), PHONICA 1.00, NOVARECO 1.00, CRIBIS 0.95, TELECOM 0.87. Esclude il calo anomalo.
- Varianza: con questi volumi, la larghezza tipica di un intervallo al 90% sull'indice di FIDES (RR_90, ultimi 12 mesi, stima su 20 seed) e circa 0.16 (1P), 0.15 (2P), 0.20 (3P): il limite inferiore supera 1 in 20/20 seed in 1P e 2P, 19/20 in 3P.

## KAN-36 - KPI del catalogo

- `prepareAffidi(dataset, scope?)`: scope (default ultimi 12 mesi di inizio affido fino ad `asOf`) e controlli qualita; ritorna gli affidi validi e gli esclusi per motivo: `MISSING_START_DATE`, `OVERLAPPING_ASSIGNMENTS` (duplicati, resta il primo), `NO_INITIAL_EXPOSURE` (mancante o <= 0), `BAND_UNKNOWN`, `INVALID_PAYMENT` (incasso negativo), `PAYMENT_WITHOUT_ASSIGNMENT`.
- `computeKpi(code, affidi, asOf)`: `RR_30/60/90/180/END`, `CURE_RATE`, `FIRST_PAY_DAYS`, `PAY_RATE`, `AVG_RECOVERED`, `RETURN_NO_PAY`, `COST_RATIO`, `NET_RECOVERY`, ponderati per esposizione. Esclusi per KPI: `IMMATURE_WINDOW` (RR_D: meno di D giorni di osservazione; RR_END: non concluso o `dataFine` > asOf), `END_DATE_MISSING`, `NOT_CONCLUDED`, `NO_PAYMENT`, `NO_COMMISSION`.
- `getKpiCatalog()` -> output di `get_kpi_catalog`; `getCollectorPerformance(dataset, {scope, kpi, minSample})` -> output di `get_collector_performance` (`meta` + `cells`), validati contro `contracts/` nei test.
- Avvisi: `prepareAffidi` ritorna anche `flagged` (es. `CLOSED_WITHOUT_END_DATE`: conclusi senza `dataFine`, restano validi).
- Limiti dello scope: `MISSING_START_DATE` e `PAYMENT_WITHOUT_ASSIGNMENT` non hanno fascia/prodotto/regione (o data): sono contati anche con filtri `fasce`/`products`/`regions` attivi (MISSING_START_DATE a prescindere anche dal periodo).
- Convenzioni: i rapporti (`%`) sono frazioni (0.18 = 18%, come `recoveryRate` negli esempi dei contratti); PAY_RATE, AVG_RECOVERED, COST_RATIO e NET_RECOVERY usano tutti gli affidi validi con incassi cumulati ad `asOf`, senza finestra di maturazione: il confronto tra recuperatori con mix di date di inizio diverso puo essere distorto (scritto anche nella descrizione del catalogo).
- Fuori perimetro: `PTP_KEPT` (nessuna promessa di pagamento nei dati; nel catalogo e `available: false`). Non ancora presenti (KAN-37): `ci`, `index`, `indexCi`, correzione per mix e bootstrap; `label` e provvisoria (`INSUFFICIENT_DATA` sotto `minSample`, altrimenti `IN_LINE`, che non e un giudizio finche non c'e KAN-37).
