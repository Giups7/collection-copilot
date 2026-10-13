import { KPI_VERSION, totalReasons } from './kpi.ts';
import { INDEX_KPIS, analyzeCollectors, type IndexRow, type MixOptions, type PerformanceLabel } from './mix.ts';
import type { ResultMeta } from './performance.ts';
import type { Dataset } from './types.ts';

/** Forme allineate a contracts/schemas/tools/rank_collectors_by_band.schema.json ($defs/output). */
export interface RankingItem {
  collector: string;
  n: number;
  index?: number;
  ci?: [number, number];
  label: PerformanceLabel;
}

export interface BandRanking {
  fascia: string;
  ranking: RankingItem[];
  ties: string[][];
}

export interface CollectorRanking {
  meta: ResultMeta;
  bands: BandRanking[];
}

/**
 * Rango per separazione: rank_i = 1 + numero di intervalli j con lower_j > upper_i (j nettamente migliore di i).
 * Se due intervalli sono disgiunti (lower_j > upper_i) chi e sopra ha un rango strettamente minore, quindi due
 * intervalli con lo stesso rango si sovrappongono sempre.
 */
export function separationRanks(cis: Array<[number, number]>): number[] {
  return cis.map(([, hi]) => 1 + cis.filter(([lo]) => lo > hi).length);
}

/**
 * Classifica per fascia (pagina 04): ordinata per limite inferiore dell'intervallo dell'indice (decrescente), poi
 * INSUFFICIENT_DATA in coda (senza indice). Pari merito (`ties`): gruppi di recuperatori con lo stesso rango per separazione
 * (vedi `separationRanks`), mai con intervalli disgiunti. Confronto descrittivo su dati storici: nessuna stima controfattuale (D-42).
 */
export function rankCollectorsByBand(dataset: Dataset, input: MixOptions = {}): CollectorRanking {
  const kpi = input.kpi ?? 'RR_90';
  if (!INDEX_KPIS.includes(kpi)) throw new Error(`KPI senza indice, non classificabile: ${kpi}`);
  const a = analyzeCollectors(dataset, input);
  const byFascia = new Map<string, IndexRow[]>();
  for (const r of a.rows) {
    if (r.fascia === null) continue;
    (byFascia.get(r.fascia) ?? byFascia.set(r.fascia, []).get(r.fascia)!).push(r);
  }

  const bands: BandRanking[] = [];
  for (const fascia of [...byFascia.keys()].sort()) {
    const rows = byFascia.get(fascia)!;
    const ranked = rows.filter((r) => r.label !== 'INSUFFICIENT_DATA' && r.indexCi && r.index !== undefined);
    const rest = rows.filter((r) => !ranked.includes(r));
    ranked.sort((x, y) => y.indexCi![0] - x.indexCi![0] || x.collector.localeCompare(y.collector));
    rest.sort((x, y) => y.n - x.n || x.collector.localeCompare(y.collector));

    // pari merito = stesso rango per separazione; nessuna catena: intervalli disgiunti hanno sempre ranghi diversi
    const ranks = separationRanks(ranked.map((r) => r.indexCi!));
    const ties: string[][] = [];
    for (const rk of [...new Set(ranks)].sort((x, y) => x - y)) {
      const members = ranked.filter((_, i) => ranks[i] === rk).map((r) => r.collector);
      if (members.length >= 2) ties.push(members);
    }

    bands.push({
      fascia,
      ranking: [...ranked, ...rest].map((r) => ({
        collector: r.collector,
        n: r.n,
        ...(r.label !== 'INSUFFICIENT_DATA' && r.index !== undefined && { index: r.index }),
        ...(r.label !== 'INSUFFICIENT_DATA' && r.indexCi && { ci: r.indexCi }),
        label: r.label,
      })),
      ties,
    });
  }

  return {
    meta: {
      tool: 'rank_collectors_by_band',
      asOf: dataset.asOf,
      scope: a.prepared.scope,
      kpi,
      kpiVersion: KPI_VERSION,
      n: a.n,
      excluded: { total: totalReasons(a.byReason), byReason: a.byReason },
      seed: a.seed,
    },
    bands,
  };
}
