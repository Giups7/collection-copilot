/**
 * Parametri "veri" del generatore del dataset sintetico (KAN-35).
 * I test di KAN-37 li usano come verita: l'indice per mix di FIDES deve risultare ~ collectorEffect.FIDES
 * (+20% a parita di mix), il calo anomalo deve emergere in `anomaly`, i controlli qualita devono contare
 * esattamente le quantita di `dirty`.
 */
export interface GeneratorParams {
  defaultSeed: number;
  /** Data di riferimento fissa dei dati. */
  asOf: string;
  /** Primo mese di inizio affido (YYYY-MM-01) e numero di mesi. */
  firstMonth: string;
  months: number;
  affidiPerMonth: number;
  /** Durata di ogni affido in giorni, uniforme in [min, max]: gli affidi con inizio + durata <= asOf sono conclusi. */
  durationRange: { min: number; max: number };
  fasciaShare: Record<string, number>;
  /** Quota di affidi per recuperatore, per fascia (CRIBIS ha pochi affidi in 3P: dati insufficienti). */
  collectorShare: Record<string, Record<string, number>>;
  /** Moltiplicatore VERO sull'importo recuperato, a parita di mix (1 = recuperatore medio). */
  collectorEffect: Record<string, number>;
  /** Tasso di provvigione sugli incassi, per recuperatore. */
  commissionRate: Record<string, number>;
  /** Mix per classe di esposizione, per recuperatore (default se assente). TELECOM riceve pratiche piu difficili. */
  classMix: Record<string, Record<string, number>>;
  defaultClassMix: Record<string, number>;
  /** Effetto di segmento sul recupero (uguale per tutti i recuperatori). */
  classEffect: Record<string, number>;
  productShare: Record<string, number>;
  productEffect: Record<string, number>;
  classificazioneShare: Record<string, number>;
  regionShare: Record<string, number>;
  /** Probabilita che un affido abbia incassi, e frazione media dell'esposizione recuperata se ne ha, per fascia. */
  payProbability: Record<string, number>;
  meanRecoveredFraction: Record<string, number>;
  /** Calo anomalo: incassi degli affidi di questo recuperatore/fascia iniziati nel mese indicato, moltiplicati. */
  anomaly: { collector: string; fascia: string; month: string; multiplier: number };
  /** Quantita note di dati sporchi (insiemi disgiunti di affidi). */
  dirty: {
    missingStartDate: number;
    missingExposure: number;
    negativeExposure: number;
    missingFascia: number;
    /** Affidi con un incasso di importo negativo. */
    negativePayment: number;
    /** Affidi conclusi senza dataFine (segnalati, non esclusi). */
    openCaseWithoutEndDate: number;
    /** Righe duplicate (stesso idAffido) aggiunte subito dopo l'originale. */
    duplicateRows: number;
    /** Incassi senza affido corrispondente. */
    orphanPayments: number;
  };
}

export const GENERATOR_PARAMS: GeneratorParams = {
  defaultSeed: 20261013,
  asOf: '2026-09-30',
  firstMonth: '2024-10-01',
  months: 24,
  affidiPerMonth: 550,
  durationRange: { min: 120, max: 240 },
  fasciaShare: { '1P': 0.4, '2P': 0.3, '3P': 0.3 },
  collectorShare: {
    '1P': { FIDES: 0.28, PHONICA: 0.3, TELECOM: 0.2, CRIBIS: 0.12, NOVARECO: 0.1 },
    '2P': { FIDES: 0.25, PHONICA: 0.28, TELECOM: 0.2, CRIBIS: 0.15, NOVARECO: 0.12 },
    '3P': { FIDES: 0.3, PHONICA: 0.3, TELECOM: 0.25, CRIBIS: 0.005, NOVARECO: 0.13 },
  },
  collectorEffect: { FIDES: 1.2, PHONICA: 1.0, TELECOM: 0.85, CRIBIS: 0.95, NOVARECO: 1.0 },
  commissionRate: { FIDES: 0.1, PHONICA: 0.09, TELECOM: 0.11, CRIBIS: 0.1, NOVARECO: 0.08 },
  classMix: { TELECOM: { '<5k': 0.2, '5-20k': 0.35, '>20k': 0.45 } },
  defaultClassMix: { '<5k': 0.5, '5-20k': 0.35, '>20k': 0.15 },
  classEffect: { '<5k': 1.1, '5-20k': 1.0, '>20k': 0.8 },
  productShare: { PERSONALE: 0.4, AUTO: 0.3, CARTA: 0.3 },
  productEffect: { PERSONALE: 1.0, AUTO: 1.1, CARTA: 0.9 },
  classificazioneShare: { UTP: 0.6, SOFFERENZA: 0.4 },
  regionShare: { LOMBARDIA: 0.3, LAZIO: 0.2, CAMPANIA: 0.2, VENETO: 0.15, SICILIA: 0.15 },
  payProbability: { '1P': 0.85, '2P': 0.8, '3P': 0.75 },
  meanRecoveredFraction: { '1P': 0.35, '2P': 0.25, '3P': 0.15 },
  anomaly: { collector: 'PHONICA', fascia: '1P', month: '2025-06', multiplier: 0.35 },
  dirty: {
    missingStartDate: 20,
    missingExposure: 10,
    negativeExposure: 10,
    missingFascia: 12,
    negativePayment: 25,
    openCaseWithoutEndDate: 15,
    duplicateRows: 20,
    orphanPayments: 30,
  },
};

const MEAN_EXPOSURE: Record<string, number> = { '<5k': 2750, '5-20k': 12500, '>20k': 45000 };

/**
 * Indice vero atteso per mix (standardizzazione indiretta, pagina 04): effetto del recuperatore diviso la media degli
 * effetti sul benchmark, dove il benchmark di ogni segmento (fascia x classe) pesa i recuperatori per i loro volumi.
 * E cio che KAN-37 deve ritrovare: per FIDES ~1.19 (non 1.20, perche il benchmark include FIDES stesso).
 * Esclude il calo anomalo e ignora il tetto al 100% di recupero (mai raggiunto con questi parametri).
 */
export function expectedIndex(p: GeneratorParams, fascia?: string): Record<string, number> {
  const fasce = fascia ? [fascia] : Object.keys(p.fasciaShare);
  const classes = Object.keys(p.defaultClassMix);
  const collectors = Object.keys(p.collectorEffect);
  const mix = (r: string, c: string) => (p.classMix[r] ?? p.defaultClassMix)[c]!;
  // volume atteso (per unita di esposizione) del recuperatore r nel segmento (f, c)
  const vol = (r: string, f: string, c: string) => p.fasciaShare[f]! * p.collectorShare[f]![r]! * mix(r, c) * MEAN_EXPOSURE[c]!;
  const k = (f: string, c: string) => p.payProbability[f]! * p.meanRecoveredFraction[f]! * p.classEffect[c]!;
  const out: Record<string, number> = {};
  for (const r of collectors) {
    let actual = 0;
    let expected = 0;
    for (const f of fasce) {
      for (const c of classes) {
        const total = collectors.reduce((s, x) => s + vol(x, f, c), 0);
        const bench = collectors.reduce((s, x) => s + vol(x, f, c) * p.collectorEffect[x]!, 0) / total;
        actual += vol(r, f, c) * k(f, c) * p.collectorEffect[r]!;
        expected += vol(r, f, c) * k(f, c) * bench;
      }
    }
    out[r] = actual / expected;
  }
  return out;
}

/** Indice atteso complessivo per recuperatore e per fascia (valori "veri" per i test di KAN-37). */
export const EXPECTED_INDEX = {
  byCollector: expectedIndex(GENERATOR_PARAMS),
  byCollectorFascia: Object.fromEntries(Object.keys(GENERATOR_PARAMS.fasciaShare).map((f) => [f, expectedIndex(GENERATOR_PARAMS, f)])),
};
