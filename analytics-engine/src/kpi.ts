import { addDays, addMonthsFirstDay, diffDays } from './dates.ts';
import type { Affido, Dataset, Scope } from './types.ts';

export const KPI_VERSION = '1.0';

/** Codici KPI calcolabili dal motore (PTP_KEPT e fuori perimetro: i dati non hanno le promesse di pagamento). */
export const COMPUTABLE_KPIS = [
  'RR_30',
  'RR_60',
  'RR_90',
  'RR_180',
  'RR_END',
  'CURE_RATE',
  'FIRST_PAY_DAYS',
  'PAY_RATE',
  'AVG_RECOVERED',
  'RETURN_NO_PAY',
  'COST_RATIO',
  'NET_RECOVERY',
] as const;
export type ComputableKpi = (typeof COMPUTABLE_KPIS)[number];

/** Motivi di esclusione. Quelli con nome del contratto (get_data_quality_report) sono riusati tali e quali. */
export type ExcludedReasons = Record<string, number>;

export interface EffectiveScope {
  from: string;
  to: string;
  fasce?: string[];
  collectors?: string[];
  products?: string[];
  regions?: string[];
}

/** Default: ultimi 12 mesi di inizio affido, fino ad asOf incluso (pagina 04, "Periodo di riferimento"). */
export function resolveScope(scope: Scope | undefined, asOf: string): EffectiveScope {
  return {
    ...scope,
    from: scope?.from ?? addMonthsFirstDay(asOf, -11),
    to: scope?.to ?? asOf,
  };
}

function bump(r: ExcludedReasons, reason: string, by = 1) {
  r[reason] = (r[reason] ?? 0) + by;
}

export function mergeReasons(into: ExcludedReasons, from: ExcludedReasons) {
  for (const [k, v] of Object.entries(from)) bump(into, k, v);
}

export function totalReasons(r: ExcludedReasons): number {
  return Object.values(r).reduce((s, v) => s + v, 0);
}

export interface PreparedAffidi {
  scope: EffectiveScope;
  /** Affidi in scope che superano i controlli di qualita (pagina 04, "Qualita dei dati"). */
  valid: Affido[];
  /** Esclusi per dato sporco, per motivo. */
  excluded: ExcludedReasons;
  /** Avvisi di qualita su affidi che restano in `valid` (pagina 04: "Segnalati"). CLOSED_WITHOUT_END_DATE: concluso senza dataFine. */
  flagged: ExcludedReasons;
}

/**
 * Applica scope e controlli di qualita. Precedenza dei motivi (un affido ha un solo motivo):
 * MISSING_START_DATE, OVERLAPPING_ASSIGNMENTS (riga duplicata: resta la prima), NO_INITIAL_EXPOSURE (mancante o <= 0),
 * BAND_UNKNOWN, INVALID_PAYMENT (incasso con importo negativo). Gli incassi senza affido sono PAYMENT_WITHOUT_ASSIGNMENT.
 * Un affido senza data di inizio non puo essere assegnato al periodo: MISSING_START_DATE e contato sempre, a prescindere
 * da periodo e filtri. PAYMENT_WITHOUT_ASSIGNMENT e filtrato solo per periodo e recuperatore (gli incassi orfani non
 * hanno fascia/prodotto/regione): resta contato anche se l'utente filtra per fasce, prodotti o regioni.
 * I conclusi senza dataFine restano validi e sono contati in `flagged.CLOSED_WITHOUT_END_DATE`.
 */
export function prepareAffidi(dataset: Dataset, scope?: Scope): PreparedAffidi {
  const eff = resolveScope(scope, dataset.asOf);
  const valid: Affido[] = [];
  const excluded: ExcludedReasons = {};
  const flagged: ExcludedReasons = {};
  const seen = new Set<string>();
  const has = (list: string[] | undefined, v: string) => !list || list.includes(v);

  for (const a of dataset.affidi) {
    if (a.dataInizio === null) {
      bump(excluded, 'MISSING_START_DATE');
      continue;
    }
    if (a.dataInizio < eff.from || a.dataInizio > eff.to) continue;
    if (!has(eff.collectors, a.recuperatore)) continue;
    if (!has(eff.products, a.segmento.prodotto) || !has(eff.regions, a.segmento.regione)) continue;
    if (a.fasciaAffido !== null && !has(eff.fasce, a.fasciaAffido)) continue;

    if (seen.has(a.idAffido)) {
      bump(excluded, 'OVERLAPPING_ASSIGNMENTS');
      continue;
    }
    seen.add(a.idAffido);
    if (a.esposizioneIniziale === null || a.esposizioneIniziale <= 0) bump(excluded, 'NO_INITIAL_EXPOSURE');
    else if (a.fasciaAffido === null) bump(excluded, 'BAND_UNKNOWN');
    else if (a.incassi.some((x) => x.importo < 0)) bump(excluded, 'INVALID_PAYMENT');
    else {
      valid.push(a);
      if (a.esito !== 'IN_CORSO' && a.dataFine === null) bump(flagged, 'CLOSED_WITHOUT_END_DATE');
    }
  }

  for (const x of dataset.incassiSenzaAffido) {
    if (x.data < eff.from || x.data > eff.to || !has(eff.collectors, x.recuperatore)) continue;
    bump(excluded, 'PAYMENT_WITHOUT_ASSIGNMENT');
  }
  return { scope: eff, valid, excluded, flagged };
}

export interface KpiResult {
  code: ComputableKpi;
  /** null se il denominatore e vuoto. Rapporti come frazione (0.18 = 18%); EUR; giorni. */
  value: number | null;
  /** Affidi che entrano nel calcolo di questo KPI. */
  n: number;
  /** Somma delle esposizioni iniziali degli affidi considerati. */
  exposure: number;
  /** Affidi di `valid` esclusi da questo KPI, per motivo (finestra non maturata, non concluso, ...). */
  excluded: ExcludedReasons;
}

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const paidTotal = (a: Affido) => sum(a.incassi.map((x) => x.importo));
const expo = (a: Affido) => a.esposizioneIniziale!;
const isConcluded = (a: Affido) => a.esito !== 'IN_CORSO';

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Incassi entro `maxDays` giorni dall'inizio (inclusi), oppure entro `endDate` se indicata. */
function paidWithin(a: Affido, limit: { maxDays: number } | { endDate: string }): number {
  const start = a.dataInizio!;
  return sum(
    a.incassi
      .filter((x) => x.data >= start && ('maxDays' in limit ? diffDays(start, x.data) <= limit.maxDays : x.data <= limit.endDate))
      .map((x) => x.importo),
  );
}

function result(code: ComputableKpi, used: Affido[], value: number | null, excluded: ExcludedReasons): KpiResult {
  return { code, value, n: used.length, exposure: sum(used.map(expo)), excluded };
}

function ratio(num: number, den: number): number | null {
  return den === 0 ? null : num / den;
}

/**
 * Calcola un KPI su affidi gia validi (output di `prepareAffidi`). `asOf` serve alle finestre di osservazione:
 * RR_D considera solo affidi con almeno D giorni di osservazione (inizio + D <= asOf);
 * RR_END solo affidi conclusi con dataFine <= asOf; CURE_RATE e RETURN_NO_PAY solo affidi conclusi;
 * FIRST_PAY_DAYS solo affidi con incasso. PAY_RATE, AVG_RECOVERED, COST_RATIO, NET_RECOVERY usano tutti gli affidi
 * (incassi cumulati ad asOf) SENZA finestra di maturazione: confrontare recuperatori con mix di date di inizio diversi
 * puo distorcere (chi ha piu affidi recenti appare peggiore).
 */
export function computeKpi(code: ComputableKpi, affidi: Affido[], asOf: string): KpiResult {
  const excluded: ExcludedReasons = {};
  const keep = (pred: (a: Affido) => string | null): Affido[] =>
    affidi.filter((a) => {
      const why = pred(a);
      if (why) bump(excluded, why);
      return why === null;
    });

  const rr = /^RR_(\d+)$/.exec(code);
  if (rr) {
    const days = Number(rr[1]);
    const used = keep((a) => (addDays(a.dataInizio!, days) <= asOf ? null : 'IMMATURE_WINDOW'));
    return result(code, used, ratio(sum(used.map((a) => paidWithin(a, { maxDays: days }))), sum(used.map(expo))), excluded);
  }

  switch (code) {
    case 'RR_END': {
      const used = keep((a) => {
        if (!isConcluded(a)) return 'IMMATURE_WINDOW';
        if (a.dataFine === null) return 'END_DATE_MISSING';
        return a.dataFine <= asOf ? null : 'IMMATURE_WINDOW';
      });
      return result(code, used, ratio(sum(used.map((a) => paidWithin(a, { endDate: a.dataFine! }))), sum(used.map(expo))), excluded);
    }
    case 'CURE_RATE': {
      const used = keep((a) => (isConcluded(a) ? null : 'NOT_CONCLUDED'));
      const cured = used.filter((a) => a.esito === 'REGOLARIZZATA' || a.esito === 'CHIUSA').length;
      return result(code, used, ratio(cured, used.length), excluded);
    }
    case 'FIRST_PAY_DAYS': {
      const used = keep((a) => (a.incassi.length > 0 ? null : 'NO_PAYMENT'));
      const firsts = used.map((a) => Math.min(...a.incassi.map((x) => diffDays(a.dataInizio!, x.data))));
      return result(code, used, used.length ? median(firsts) : null, excluded);
    }
    case 'PAY_RATE':
      return result(code, affidi, ratio(affidi.filter((a) => a.incassi.length > 0).length, affidi.length), excluded);
    case 'AVG_RECOVERED':
      return result(code, affidi, ratio(sum(affidi.map(paidTotal)), affidi.length), excluded);
    case 'RETURN_NO_PAY': {
      const used = keep((a) => (isConcluded(a) ? null : 'NOT_CONCLUDED'));
      return result(code, used, ratio(used.filter((a) => a.incassi.length === 0).length, used.length), excluded);
    }
    case 'COST_RATIO': {
      const used = keep((a) => (a.provvigioni === null ? 'NO_COMMISSION' : null));
      return result(code, used, ratio(sum(used.map((a) => a.provvigioni!)), sum(used.map(paidTotal))), excluded);
    }
    case 'NET_RECOVERY': {
      const used = keep((a) => (a.provvigioni === null ? 'NO_COMMISSION' : null));
      return result(code, used, used.length ? sum(used.map(paidTotal)) - sum(used.map((a) => a.provvigioni!)) : null, excluded);
    }
    default:
      throw new Error(`KPI non calcolabile: ${String(code)}`);
  }
}
