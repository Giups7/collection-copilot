import { addDays, addMonthsFirstDay, diffDays } from './dates.ts';
import { prepareAffidi, totalReasons, type PreparedAffidi } from './kpi.ts';
import type { ResultMeta } from './performance.ts';
import type { Affido, Dataset, Scope } from './types.ts';

/** Aggregazioni di portafoglio: forme allineate a contracts/schemas/tools/{get_portfolio_summary,get_recovery_trend,get_portfolio_distribution}.schema.json ($defs/output). */

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const paid = (a: Affido) => sum(a.incassi.map((x) => x.importo));

function metaOf(tool: string, dataset: Dataset, prep: PreparedAffidi): ResultMeta {
  return {
    tool,
    asOf: dataset.asOf,
    scope: prep.scope,
    n: prep.valid.length,
    excluded: { total: totalReasons(prep.excluded), byReason: prep.excluded },
    seed: dataset.seed,
  };
}

function totals(valid: Affido[]) {
  const exposure = sum(valid.map((a) => a.esposizioneIniziale!));
  const recovered = sum(valid.map(paid));
  return { exposure, recovered, recoveryRate: exposure === 0 ? 0 : recovered / exposure };
}

export interface PortfolioSummary {
  meta: ResultMeta;
  cases: number;
  assignments: number;
  activeAssignments: number;
  exposure: number;
  recovered: number;
  recoveryRate: number;
  previousPeriod: { exposure: number; recovered: number; recoveryRate: number };
}

/**
 * KPI di portafoglio sugli affidi validi dello scope. `previousPeriod`: stessa durata, immediatamente prima di `from`, stessi filtri.
 * `recoveryRate` = incassato (cumulato ad asOf) / esposizione, senza finestra di maturazione.
 */
export function getPortfolioSummary(dataset: Dataset, input: { scope?: Scope } = {}): PortfolioSummary {
  const prep = prepareAffidi(dataset, input.scope);
  const { from, to } = prep.scope;
  const len = diffDays(from, to) + 1;
  const prevTo = addDays(from, -1);
  const prev = prepareAffidi(dataset, { ...prep.scope, from: addDays(prevTo, -(len - 1)), to: prevTo });
  return {
    meta: metaOf('get_portfolio_summary', dataset, prep),
    cases: new Set(prep.valid.map((a) => a.pratica)).size,
    assignments: prep.valid.length,
    activeAssignments: prep.valid.filter((a) => a.esito === 'IN_CORSO').length,
    ...totals(prep.valid),
    previousPeriod: totals(prev.valid),
  };
}

export type TrendGranularity = 'MONTH' | 'QUARTER';
export type TrendGroupBy = 'NONE' | 'COLLECTOR' | 'FASCIA';
export type TrendMeasure = 'RECOVERED' | 'RECOVERY_RATE';

export interface RecoveryTrend {
  meta: ResultMeta;
  granularity: TrendGranularity;
  measure: TrendMeasure;
  periods: string[];
  series: { name: string; values: (number | null)[] }[];
}

const periodOf = (iso: string, granularity: TrendGranularity) =>
  granularity === 'QUARTER' ? `${iso.slice(0, 4)}-Q${Math.floor((Number(iso.slice(5, 7)) - 1) / 3) + 1}` : iso.slice(0, 7);

/**
 * Andamento per coorte: gli affidi sono attribuiti al periodo di inizio affido (come lo scope).
 * RECOVERED = incassato (ad asOf) dagli affidi del periodo; RECOVERY_RATE = incassato / esposizione degli stessi affidi
 * (null se il periodo non ha esposizione). Le coorti recenti hanno quindi valori ancora in crescita.
 */
export function getRecoveryTrend(
  dataset: Dataset,
  input: { scope?: Scope; granularity?: TrendGranularity; groupBy?: TrendGroupBy; measure?: TrendMeasure } = {},
): RecoveryTrend {
  const granularity = input.granularity ?? 'MONTH';
  const groupBy = input.groupBy ?? 'NONE';
  const measure = input.measure ?? 'RECOVERED';
  const prep = prepareAffidi(dataset, input.scope);

  const periods: string[] = [];
  for (let d = addMonthsFirstDay(prep.scope.from, 0); d <= prep.scope.to; d = addMonthsFirstDay(d, 1)) {
    const p = periodOf(d, granularity);
    if (periods[periods.length - 1] !== p) periods.push(p);
  }

  const keyOf = (a: Affido) => (groupBy === 'COLLECTOR' ? a.recuperatore : groupBy === 'FASCIA' ? a.fasciaAffido! : 'Totale');
  const groups = new Map<string, Map<string, Affido[]>>();
  for (const a of prep.valid) {
    const cohorts = groups.get(keyOf(a)) ?? groups.set(keyOf(a), new Map()).get(keyOf(a))!;
    const p = periodOf(a.dataInizio!, granularity);
    (cohorts.get(p) ?? cohorts.set(p, []).get(p)!).push(a);
  }
  if (groups.size === 0) groups.set('Totale', new Map());

  const series = [...groups.keys()].sort().map((name) => ({
    name,
    values: periods.map((p) => {
      const as = groups.get(name)!.get(p) ?? [];
      if (measure === 'RECOVERED') return sum(as.map(paid));
      const exposure = sum(as.map((a) => a.esposizioneIniziale!));
      return exposure === 0 ? null : sum(as.map(paid)) / exposure;
    }),
  }));

  return { meta: metaOf('get_recovery_trend', dataset, prep), granularity, measure, periods, series };
}

export type DistributionDimension = 'FASCIA' | 'PRODUCT' | 'CLASSIFICATION' | 'REGION' | 'EXPOSURE_CLASS' | 'COLLECTOR';
export type DistributionMeasure = 'COUNT' | 'EXPOSURE' | 'RECOVERED';

export interface PortfolioDistribution {
  meta: ResultMeta;
  dimension: DistributionDimension;
  measure: DistributionMeasure;
  items: { category: string; value: number; share: number }[];
}

const DIMENSIONS: Record<DistributionDimension, (a: Affido) => string> = {
  FASCIA: (a) => a.fasciaAffido!,
  PRODUCT: (a) => a.segmento.prodotto,
  CLASSIFICATION: (a) => a.segmento.classificazione,
  REGION: (a) => a.segmento.regione,
  EXPOSURE_CLASS: (a) => a.segmento.classeEsposizione,
  COLLECTOR: (a) => a.recuperatore,
};

/** Composizione del portafoglio per dimensione, ordinata per valore decrescente; `share` = quota sul totale (0 se il totale e 0). */
export function getPortfolioDistribution(
  dataset: Dataset,
  input: { scope?: Scope; dimension: DistributionDimension; measure?: DistributionMeasure },
): PortfolioDistribution {
  const measure = input.measure ?? 'COUNT';
  const categoryOf = DIMENSIONS[input.dimension];
  if (!categoryOf) throw new Error(`Dimensione non supportata: ${String(input.dimension)}`);
  const prep = prepareAffidi(dataset, input.scope);
  const value = (a: Affido) => (measure === 'COUNT' ? 1 : measure === 'EXPOSURE' ? a.esposizioneIniziale! : paid(a));

  const byCategory = new Map<string, number>();
  for (const a of prep.valid) byCategory.set(categoryOf(a), (byCategory.get(categoryOf(a)) ?? 0) + value(a));
  const total = sum([...byCategory.values()]);
  const items = [...byCategory]
    .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
    .map(([category, v]) => ({ category, value: v, share: total === 0 ? 0 : v / total }));
  return { meta: metaOf('get_portfolio_distribution', dataset, prep), dimension: input.dimension, measure, items };
}
