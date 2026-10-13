import {
  COMPUTABLE_KPIS,
  KPI_VERSION,
  computeKpi,
  mergeReasons,
  prepareAffidi,
  totalReasons,
  type ComputableKpi,
  type ExcludedReasons,
} from './kpi.ts';
import type { Affido, Dataset, Scope } from './types.ts';

/** Forme allineate a contracts/schemas/tools/get_collector_performance.schema.json ($defs/output). */
export type PerformanceLabel = 'ABOVE' | 'IN_LINE' | 'BELOW' | 'INSUFFICIENT_DATA';

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

export interface CollectorPerformanceInput {
  scope?: Scope;
  kpi?: ComputableKpi;
  minSample?: number;
}

/**
 * KPI semplice per recuperatore x fascia (KAN-36).
 * Non ancora presenti: `ci`, `index`, `indexCi` (correzione per mix e bootstrap, KAN-37).
 * Di conseguenza `label` e provvisoria: INSUFFICIENT_DATA sotto `minSample`, altrimenti IN_LINE
 * (l'etichettatura vera richiede l'intervallo di confidenza dell'indice): IN_LINE non e un giudizio finche non c'e KAN-37.
 * `meta.excluded` include MISSING_START_DATE e PAYMENT_WITHOUT_ASSIGNMENT anche fuori dai filtri fasce/prodotti/regioni.
 */
export function getCollectorPerformance(dataset: Dataset, input: CollectorPerformanceInput = {}): CollectorPerformance {
  const kpi = input.kpi ?? 'RR_90';
  if (!COMPUTABLE_KPIS.includes(kpi)) throw new Error(`KPI non calcolabile: ${kpi}`);
  const minSample = input.minSample ?? 30;
  const { scope, valid, excluded } = prepareAffidi(dataset, input.scope);

  const groups = new Map<string, Affido[]>();
  for (const a of valid) {
    const key = `${a.recuperatore}\u0000${a.fasciaAffido}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(a);
  }

  const byReason: ExcludedReasons = { ...excluded };
  const cells: PerformanceCell[] = [];
  let n = 0;
  for (const key of [...groups.keys()].sort()) {
    const [collector, fascia] = key.split('\u0000') as [string, string];
    const r = computeKpi(kpi, groups.get(key)!, dataset.asOf);
    mergeReasons(byReason, r.excluded);
    n += r.n;
    cells.push({
      collector,
      fascia,
      n: r.n,
      exposure: r.exposure,
      ...(r.value !== null && { value: r.value }),
      label: r.n < minSample ? 'INSUFFICIENT_DATA' : 'IN_LINE',
    });
  }

  return {
    meta: {
      tool: 'get_collector_performance',
      asOf: dataset.asOf,
      scope,
      kpi,
      kpiVersion: KPI_VERSION,
      n,
      excluded: { total: totalReasons(byReason), byReason },
    },
    cells,
  };
}
