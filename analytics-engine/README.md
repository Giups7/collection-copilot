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
- Fuori perimetro: `PTP_KEPT` (nessuna promessa di pagamento nei dati; nel catalogo e `available: false`).

## KAN-37 / KAN-38 - Indice per mix, intervalli, classifica

Confronti descrittivi su dati storici (D-42): l'atteso e il rendimento medio osservato del portafoglio sullo stesso mix; nessuna stima controfattuale ("cosa avrebbe incassato un altro recuperatore").

- `analyzeCollectors(dataset, opts)` (`src/mix.ts`): righe per recuperatore x fascia e per recuperatore su tutte le fasce (`fascia: null`, indice globale con atteso sui segmenti fascia x prodotto x classe). `opts` (`MixOptions`): `scope`, `kpi` (default `RR_90`), `mixAdjusted` (default true; false = benchmark della sola fascia), `minSample` (30), `resamples` (1000), `seed` (default `GENERATOR_PARAMS.defaultSeed`), `segmentMinN` (30).
- Standardizzazione indiretta: `INDICE = Σ num / Σ (den x RR_s)`, con `RR_s` = tasso del portafoglio nel segmento, benchmark = tutti i recuperatori nello scope (il filtro `collectors` restringe solo le righe riportate). Segmenti sotto `segmentMinN` affidi accorpati: fascia x prodotto x classe, poi fascia x classe, poi fascia.
- Indice disponibile per `RR_30/60/90/180/END`, `CURE_RATE`, `PAY_RATE`, `AVG_RECOVERED` (`INDEX_KPIS`; piu alto = meglio). Per gli altri KPI niente indice e `label` IN_LINE (nessun giudizio); `rankCollectorsByBand` lancia errore.
- Intervalli al 90%: bootstrap sugli affidi del recuperatore (benchmark fisso), seed per cella = `seed` xor hash(recuperatore|fascia), quindi stesso seed = stessi intervalli e risultati indipendenti dalle altre celle; `indexCi` per l'indice e `ci` per il valore (RR_*, AVG_RECOVERED); `ci` di Wilson (`wilsonInterval`) per `CURE_RATE` e `PAY_RATE`. `meta.seed` riporta il seed. 1000 ricampionamenti sul dataset di default: circa 0,5 s; nei test se ne usano 400.
- Etichette (`label`): sotto `minSample` affidi INSUFFICIENT_DATA (nessun `ci`/`index`); altrimenti ABOVE (limite inferiore > 1), BELOW (limite superiore < 1), IN_LINE.
- `getCollectorPerformance` (tool `get_collector_performance`) ora riempie `ci`, `index`, `indexCi`, `label` e `meta.seed`.
- `rankCollectorsByBand(dataset, opts)` (tool `rank_collectors_by_band`, schema `{meta, bands: [{fascia, ranking, ties}]}`): per fascia ordina per limite inferiore di `indexCi` (decrescente), INSUFFICIENT_DATA in coda senza indice. `ties`: pari merito = stesso rango per separazione (D-43; `separationRanks`: rango = 1 + numero di recuperatori con limite inferiore sopra il limite superiore del recuperatore). Mai in parita due intervalli disgiunti; ma due intervalli sovrapposti possono avere ranghi diversi se un terzo li separa (es. A[1,5], B[4,9], C[6,10]: A e B si sovrappongono ma A ha rango 2 e B rango 1, perche C e nettamente sopra A e non sopra B; B e C hanno rango 1).
- Valori sul seed di default (RR_90, ultimi 12 mesi): FIDES indice globale ~1,22 (IC 1,15-1,28), ABOVE in tutte le fasce; TELECOM ~0,87 (0,82-0,91), BELOW; l'indice atteso vero (`EXPECTED_INDEX`) cade negli IC (FIDES 1,20, TELECOM 0,87). CRIBIS in 3P: INSUFFICIENT_DATA (7 affidi).

- Indice non calcolabile (con almeno `minSample` affidi ma esposizione attesa totale 0, per esempio nessun incasso nel benchmark): `label` INSUFFICIENT_DATA, senza `index`/`indexCi`.
- Limiti noti: il benchmark include il recuperatore stesso e nel bootstrap resta fisso; gli IC risultano quindi leggermente stretti e l'indice tende un po' verso 1.
