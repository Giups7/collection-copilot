import { COMPUTABLE_KPIS, KPI_VERSION, totalReasons, type ExcludedReasons } from './kpi.ts';
import { analyzeCollectors, type MixOptions, type PerformanceLabel } from './mix.ts';
import type { Dataset, Scope } from './types.ts';

export type { PerformanceLabel };

/** Forme allineate a contracts/schemas/tools/get_collector_performance.schema.json ($defs/output). */
export interface PerformanceCell {
  collector: string;
  fascia: string;
  n: number;
  exposure: number;
  value?: number;
  ci?: [number, number];
  index?: number;
  indexCi?: [number, number];
  label: PerformanceLabel;
}

export interface ResultMeta {
  tool: string;
  asOf: string;
  scope: Scope;
  kpi?: string;
  kpiVersion?: string;
  n?: number;
  excluded?: { total: number; byReason: ExcludedReasons };
  seed?: number;
}

export interface CollectorPerformance {
  meta: ResultMeta;
  cells: PerformanceCell[];
}

export type CollectorPerformanceInput = MixOptions;

/**
 * KPI per recuperatore x fascia con intervalli e indice corretto per mix (KAN-37).
 * `ci`: Wilson (CURE_RATE, PAY_RATE) o bootstrap (RR_*, AVG_RECOVERED) sul valore; `index`/`indexCi`: standardizzazione
 * indiretta, bootstrap con seed fisso (`meta.seed`). `label` come da pagina 04. Sotto `minSample` (default 30):
 * INSUFFICIENT_DATA, senza ci ne indice. Per i KPI senza indice (FIRST_PAY_DAYS, RETURN_NO_PAY, COST_RATIO, NET_RECOVERY)
 * `label` e IN_LINE: nessun giudizio. Confronto descrittivo su dati storici (D-42).
 * `meta.excluded` include MISSING_START_DATE e PAYMENT_WITHOUT_ASSIGNMENT anche fuori dai filtri fasce/prodotti/regioni.
 */
export function getCollectorPerformance(dataset: Dataset, input: CollectorPerformanceInput = {}): CollectorPerformance {
  const kpi = input.kpi ?? 'RR_90';
  if (!COMPUTABLE_KPIS.includes(kpi)) throw new Error(`KPI non calcolabile: ${kpi}`);
  const a = analyzeCollectors(dataset, input);
  const cells: PerformanceCell[] = a.rows.filter((r) => r.fascia !== null).map((r) => ({ ...r, fascia: r.fascia! }));
  return {
    meta: {
      tool: 'get_collector_performance',
      asOf: dataset.asOf,
      scope: a.prepared.scope,
      kpi,
      kpiVersion: KPI_VERSION,
      n: a.n,
      excluded: { total: totalReasons(a.byReason), byReason: a.byReason },
      seed: a.seed,
    },
    cells,
  };
}
