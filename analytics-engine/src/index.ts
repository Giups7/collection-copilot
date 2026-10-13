export { generateDataset } from './generate.ts';
export { GENERATOR_PARAMS, EXPECTED_INDEX, expectedIndex, type GeneratorParams } from './params.ts';
export { createRng } from './prng.ts';
export { getKpiCatalog, type KpiCatalog, type KpiCatalogEntry } from './catalog.ts';
export {
  COMPUTABLE_KPIS,
  KPI_VERSION,
  computeKpi,
  prepareAffidi,
  resolveScope,
  type ComputableKpi,
  type ExcludedReasons,
  type KpiResult,
  type PreparedAffidi,
} from './kpi.ts';
export {
  getCollectorPerformance,
  type CollectorPerformance,
  type CollectorPerformanceInput,
  type PerformanceCell,
  type PerformanceLabel,
} from './performance.ts';
export type { Affido, Dataset, Esito, Incasso, IncassoSenzaAffido, Scope, Segmento } from './types.ts';
