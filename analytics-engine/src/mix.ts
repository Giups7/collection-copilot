import { computeKpi, mergeReasons, prepareAffidi, type ComputableKpi, type ExcludedReasons, type PreparedAffidi } from './kpi.ts';
import { GENERATOR_PARAMS } from './params.ts';
import { createRng } from './prng.ts';
import type { Affido, Dataset, Scope } from './types.ts';

/**
 * Indice corretto per il mix (standardizzazione indiretta, pagina 04) e intervalli di confidenza (KAN-37).
 * Confronto DESCRITTIVO su dati storici (D-42): l'atteso e il rendimento medio osservato del portafoglio sullo stesso mix,
 * non una stima di cosa avrebbe incassato un altro recuperatore.
 */

export type PerformanceLabel = 'ABOVE' | 'IN_LINE' | 'BELOW' | 'INSUFFICIENT_DATA';

/** KPI per cui si calcola l'indice (rapporto di somme per affido, "piu alto = meglio"). */
export const INDEX_KPIS: readonly ComputableKpi[] = ['RR_30', 'RR_60', 'RR_90', 'RR_180', 'RR_END', 'CURE_RATE', 'PAY_RATE', 'AVG_RECOVERED'];
/** KPI che sono tassi su conteggi: intervallo di Wilson sul valore. */
const RATE_KPIS: readonly ComputableKpi[] = ['CURE_RATE', 'PAY_RATE'];

export const DEFAULT_RESAMPLES = 1000;
export const DEFAULT_SEGMENT_MIN_N = 30;
export const CONFIDENCE_LEVEL = 0.9;
const Z90 = 1.6448536269514722;

export interface MixOptions {
  scope?: Scope;
  kpi?: ComputableKpi;
  /** Se false, benchmark = media della sola fascia (nessuna correzione per mix). Default true. */
  mixAdjusted?: boolean;
  /** Volume minimo di affidi per recuperatore e fascia. Default 30. */
  minSample?: number;
  /** Numero di ricampionamenti bootstrap. Default 1000 (pagina 04). */
  resamples?: number;
  /** Seed del bootstrap. Default: seed del generatore (GENERATOR_PARAMS.defaultSeed). */
  seed?: number;
  /** Soglia di accorpamento dei segmenti (affidi). Default 30. */
  segmentMinN?: number;
}

export interface IndexRow {
  collector: string;
  /** null = tutte le fasce (indice globale, atteso calcolato sui segmenti fascia x prodotto x classe). */
  fascia: string | null;
  n: number;
  exposure: number;
  value?: number;
  ci?: [number, number];
  index?: number;
  indexCi?: [number, number];
  label: PerformanceLabel;
}

export interface MixAnalysis {
  prepared: PreparedAffidi;
  kpi: ComputableKpi;
  seed: number;
  resamples: number;
  rows: IndexRow[];
  /** Totale affidi considerati nelle celle recuperatore x fascia. */
  n: number;
  /** Esclusioni di qualita + per-KPI. */
  byReason: ExcludedReasons;
}

/** Intervallo di Wilson al 90% per una proporzione. */
export function wilsonInterval(successes: number, n: number, z = Z90): [number, number] {
  if (n <= 0) return [0, 1];
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

function quantile(sorted: number[], q: number): number {
  const pos = q * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

interface Unit {
  fascia: string;
  prodotto: string;
  classe: string;
  num: number;
  den: number;
}

/** Contributo di ogni affido al KPI (num/den), per i soli affidi che il KPI considera (n = numero di unita). */
function buildUnits(kpi: ComputableKpi, affidi: Affido[], asOf: string): Unit[] {
  const isRr = kpi.startsWith('RR_');
  const units: Unit[] = [];
  for (const a of affidi) {
    const r = computeKpi(kpi, [a], asOf);
    if (r.n === 0 || r.value === null) continue;
    const den = isRr ? a.esposizioneIniziale! : 1;
    units.push({
      fascia: a.fasciaAffido!,
      prodotto: a.segmento.prodotto,
      classe: a.segmento.classeEsposizione,
      num: r.value * den,
      den,
    });
  }
  return units;
}

type Benchmark = (u: Unit) => number;

/** Benchmark RR_s: tasso del portafoglio per segmento, con accorpamento dei segmenti sotto soglia (via prodotto, poi classe). */
function buildBenchmark(units: Unit[], mixAdjusted: boolean, minN: number): Benchmark {
  const keyFns: Array<(u: Unit) => string> = mixAdjusted
    ? [(u) => `${u.fascia}|${u.prodotto}|${u.classe}`, (u) => `${u.fascia}|${u.classe}`, (u) => u.fascia]
    : [(u) => u.fascia];
  const tables = keyFns.map((fn) => {
    const m = new Map<string, { num: number; den: number; n: number }>();
    for (const u of units) {
      const k = fn(u);
      const t = m.get(k) ?? m.set(k, { num: 0, den: 0, n: 0 }).get(k)!;
      t.num += u.num;
      t.den += u.den;
      t.n += 1;
    }
    return m;
  });
  const last = keyFns.length - 1;
  return (u) => {
    for (let l = 0; l <= last; l++) {
      const t = tables[l]!.get(keyFns[l]!(u))!;
      if (t.n >= minN || l === last) return t.den > 0 ? t.num / t.den : 0;
    }
    return 0;
  };
}

function computeRow(
  collector: string,
  fascia: string | null,
  units: Unit[],
  kpi: ComputableKpi,
  bench: Benchmark,
  o: { minSample: number; resamples: number; seed: number },
  base: { value: number | null; n: number; exposure: number },
): IndexRow {
  const n = base.n;
  const row: IndexRow = { collector, fascia, n, exposure: base.exposure, label: 'INSUFFICIENT_DATA' };
  if (base.value !== null) row.value = base.value;
  if (n < o.minSample) return row; // INSUFFICIENT_DATA

  const hasIndex = INDEX_KPIS.includes(kpi);
  const num = units.map((u) => u.num);
  const den = units.map((u) => u.den);
  const exp = units.map((u) => u.den * bench(u));
  const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
  const sumExp = sum(exp);

  if (RATE_KPIS.includes(kpi)) row.ci = wilsonInterval(sum(num), n);
  const wantIndex = hasIndex && sumExp > 0;
  const wantValueCi = hasIndex && !RATE_KPIS.includes(kpi);
  if (wantIndex) row.index = sum(num) / sumExp;

  if (wantIndex || wantValueCi) {
    const rng = createRng((o.seed ^ hashString(`${collector}|${fascia ?? '*'}`)) >>> 0);
    const idx: number[] = [];
    const vals: number[] = [];
    for (let b = 0; b < o.resamples; b++) {
      let sn = 0;
      let sd = 0;
      let se = 0;
      for (let i = 0; i < n; i++) {
        const j = Math.floor(rng() * n);
        sn += num[j]!;
        sd += den[j]!;
        se += exp[j]!;
      }
      if (se > 0) idx.push(sn / se);
      if (sd > 0) vals.push(sn / sd);
    }
    const tail = (1 - CONFIDENCE_LEVEL) / 2;
    const ci = (xs: number[]): [number, number] | undefined => {
      if (xs.length === 0) return undefined;
      xs.sort((a, b) => a - b);
      return [quantile(xs, tail), quantile(xs, 1 - tail)];
    };
    if (wantIndex) {
      const c = ci(idx);
      if (c) row.indexCi = c;
    }
    if (wantValueCi) {
      const c = ci(vals);
      if (c) row.ci = c;
    }
  }

  // KPI con indice ma atteso nullo (indice non calcolabile): nessun giudizio possibile, quindi dati insufficienti
  if (hasIndex && (row.index === undefined || row.indexCi === undefined)) row.label = 'INSUFFICIENT_DATA';
  else if (row.index === undefined || row.indexCi === undefined) row.label = 'IN_LINE';
  else row.label = row.indexCi[0] > 1 ? 'ABOVE' : row.indexCi[1] < 1 ? 'BELOW' : 'IN_LINE';
  return row;
}

/**
 * Calcola indice e intervalli per ogni recuperatore x fascia (`fascia` valorizzata) e per recuperatore su tutte le fasce
 * (`fascia: null`). Il benchmark e l'insieme di tutti i recuperatori nello scope (il filtro `collectors` restringe solo
 * le righe riportate, non il benchmark). Bootstrap sugli affidi del recuperatore con benchmark fisso, seed fisso.
 */
export function analyzeCollectors(dataset: Dataset, input: MixOptions = {}): MixAnalysis {
  const kpi = input.kpi ?? 'RR_90';
  const minSample = input.minSample ?? 30;
  const resamples = input.resamples ?? DEFAULT_RESAMPLES;
  const seed = input.seed ?? GENERATOR_PARAMS.defaultSeed;
  const mixAdjusted = input.mixAdjusted ?? true;
  const opts = { minSample, resamples, seed };

  const prepared = prepareAffidi(dataset, input.scope);
  const byReason: ExcludedReasons = { ...prepared.excluded };
  const benchPool = input.scope?.collectors ? prepareAffidi(dataset, { ...input.scope, collectors: undefined }).valid : prepared.valid;
  const bench = buildBenchmark(buildUnits(kpi, benchPool, dataset.asOf), mixAdjusted, input.segmentMinN ?? DEFAULT_SEGMENT_MIN_N);

  const groups = new Map<string, Affido[]>();
  const perCollector = new Map<string, Affido[]>();
  for (const a of prepared.valid) {
    const key = `${a.recuperatore}\u0000${a.fasciaAffido}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(a);
    (perCollector.get(a.recuperatore) ?? perCollector.set(a.recuperatore, []).get(a.recuperatore)!).push(a);
  }

  const rows: IndexRow[] = [];
  let n = 0;
  for (const key of [...groups.keys()].sort()) {
    const [collector, fascia] = key.split('\u0000') as [string, string];
    const affidi = groups.get(key)!;
    const r = computeKpi(kpi, affidi, dataset.asOf);
    mergeReasons(byReason, r.excluded);
    n += r.n;
    rows.push(computeRow(collector, fascia, buildUnits(kpi, affidi, dataset.asOf), kpi, bench, opts, r));
  }
  for (const collector of [...perCollector.keys()].sort()) {
    const affidi = perCollector.get(collector)!;
    const r = computeKpi(kpi, affidi, dataset.asOf);
    rows.push(computeRow(collector, null, buildUnits(kpi, affidi, dataset.asOf), kpi, bench, opts, r));
  }
  return { prepared, kpi, seed, resamples, rows, n, byReason };
}
