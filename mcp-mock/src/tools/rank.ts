/**
 * ADATTATORE verso l'indice corretto per mix, gli intervalli e la classifica di analytics-engine (KAN-37/38).
 * E l'unico punto del server che conosce le firme della libreria di analisi statistica: nessuna logica statistica qui,
 * solo traduzione tra gli input dei tool e le funzioni `getCollectorPerformance`, `analyzeCollectors`, `rankCollectorsByBand`.
 * Se le firme della libreria cambiano, si interviene solo in questo file.
 */
import {
  INDEX_KPIS,
  analyzeCollectors,
  getCollectorPerformance,
  rankCollectorsByBand,
  type BandRanking,
  type CollectorPerformance,
  type ComputableKpi,
  type Dataset,
  type Scope,
} from '../../../analytics-engine/src/index.ts';

export interface PerformanceRequest {
  scope?: Scope;
  kpi: ComputableKpi;
  mixAdjusted: boolean;
  minSample: number;
}

/** Il seed del bootstrap e quello del dataset: stesso dataset, stessi intervalli. */
export function collectorPerformance(dataset: Dataset, req: PerformanceRequest): CollectorPerformance {
  return getCollectorPerformance(dataset, { ...req, seed: dataset.seed });
}

export function rankByBand(dataset: Dataset, req: PerformanceRequest): { meta: CollectorPerformance['meta']; bands: BandRanking[] } {
  const { meta, bands } = rankCollectorsByBand(dataset, { ...req, seed: dataset.seed });
  return { meta, bands };
}

export interface CompareCell {
  index?: number;
  indexCi?: [number, number];
  ci?: [number, number];
}

/**
 * Indice e intervalli per recuperatore (nella fascia) di un KPI. Il benchmark e l'intera fascia, non solo i
 * recuperatori confrontati. KPI senza indice (es. FIRST_PAY_DAYS): oggetto vuoto per ogni recuperatore.
 */
export function compareIndex(
  dataset: Dataset,
  req: { scope?: Scope; fascia: string; kpi: ComputableKpi; mixAdjusted: boolean; minSample: number },
): (collector: string) => CompareCell {
  if (!INDEX_KPIS.includes(req.kpi)) return () => ({});
  const a = analyzeCollectors(dataset, {
    scope: { ...req.scope, fasce: [req.fascia], collectors: undefined },
    kpi: req.kpi,
    mixAdjusted: req.mixAdjusted,
    minSample: req.minSample,
    seed: dataset.seed,
  });
  return (collector) => {
    const r = a.rows.find((x) => x.fascia === req.fascia && x.collector === collector);
    if (!r || r.label === 'INSUFFICIENT_DATA') return {};
    return { ...(r.index !== undefined && { index: r.index }), ...(r.indexCi && { indexCi: r.indexCi }), ...(r.ci && { ci: r.ci }) };
  };
}
