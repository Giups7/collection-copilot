import { describe, expect, it } from 'vitest';
import { EXPECTED_INDEX, GENERATOR_PARAMS as P, computeKpi, generateDataset, prepareAffidi, type Affido } from '../src/index.ts';

const ds = generateDataset();
const baseCount = P.months * P.affidiPerMonth;

describe('generatore: determinismo', () => {
  it('stesso seed, stesso dataset', () => {
    expect(generateDataset(42)).toEqual(generateDataset(42));
    expect(JSON.stringify(generateDataset())).toBe(JSON.stringify(ds));
  });
  it('seed diversi, dataset diversi', () => {
    expect(generateDataset(1).affidi[0]).not.toEqual(generateDataset(2).affidi[0]);
  });
});

describe('generatore: struttura', () => {
  it('24 mesi, 5 recuperatori, 3 fasce, asOf fisso', () => {
    expect(ds.asOf).toBe(P.asOf);
    const starts = ds.affidi.map((a) => a.dataInizio).filter((d): d is string => d !== null).sort();
    expect(starts[0]!.slice(0, 7)).toBe('2024-10');
    expect(starts.at(-1)!.slice(0, 7)).toBe('2026-09');
    expect(new Set(ds.affidi.map((a) => a.recuperatore)).size).toBe(5);
    expect(new Set(ds.affidi.map((a) => a.fasciaAffido).filter(Boolean))).toEqual(new Set(['1P', '2P', '3P']));
    expect(ds.affidi.length).toBe(baseCount + P.dirty.duplicateRows);
  });
  it('i record hanno i campi della pagina 04 e nessun incasso nel futuro', () => {
    const keys = ['idAffido', 'pratica', 'recuperatore', 'fasciaAffido', 'dataInizio', 'dataFine', 'esposizioneIniziale', 'segmento', 'incassi', 'esito', 'provvigioni'];
    for (const a of ds.affidi) {
      expect(Object.keys(a).sort()).toEqual([...keys].sort());
      for (const i of a.incassi) expect(i.data <= ds.asOf).toBe(true);
    }
  });
});

describe('generatore: dati sporchi in quantita note', () => {
  const d = P.dirty;
  it('conteggi esatti', () => {
    const rows = ds.affidi;
    expect(rows.filter((a) => a.dataInizio === null).length).toBe(d.missingStartDate);
    expect(rows.filter((a) => a.esposizioneIniziale === null).length).toBe(d.missingExposure);
    expect(rows.filter((a) => a.esposizioneIniziale !== null && a.esposizioneIniziale < 0).length).toBe(d.negativeExposure);
    expect(rows.filter((a) => a.fasciaAffido === null).length).toBe(d.missingFascia);
    expect(rows.filter((a) => a.incassi.some((i) => i.importo < 0)).length).toBe(d.negativePayment);
    expect(rows.length - new Set(rows.map((a) => a.idAffido)).size).toBe(d.duplicateRows);
    expect(rows.filter((a) => a.esito !== 'IN_CORSO' && a.dataFine === null).length).toBe(d.openCaseWithoutEndDate);
    expect(ds.incassiSenzaAffido.length).toBe(d.orphanPayments);
  });
  it('prepareAffidi su tutto il periodo ritrova gli esclusi attesi', () => {
    const { excluded, valid } = prepareAffidi(ds, { from: '2024-10-01', to: '2026-09-30' });
    expect(excluded).toEqual({
      MISSING_START_DATE: d.missingStartDate,
      OVERLAPPING_ASSIGNMENTS: d.duplicateRows,
      NO_INITIAL_EXPOSURE: d.missingExposure + d.negativeExposure,
      BAND_UNKNOWN: d.missingFascia,
      INVALID_PAYMENT: d.negativePayment,
      PAYMENT_WITHOUT_ASSIGNMENT: d.orphanPayments,
    });
    expect(valid.length).toBe(baseCount - d.missingStartDate - d.missingExposure - d.negativeExposure - d.missingFascia - d.negativePayment);
  });
});

describe('generatore: differenze note di performance', () => {
  const valid = prepareAffidi(ds, { from: '2024-10-01', to: '2026-09-30' }).valid;
  const rrEnd = (pred: (a: Affido) => boolean) => computeKpi('RR_END', valid.filter(pred), ds.asOf).value!;

  it('FIDES recupera ~+20% rispetto a PHONICA a parita di mix (stessa composizione per classe; PHONICA senza il mese anomalo)', () => {
    const anomalous = (a: Affido) => a.fasciaAffido === P.anomaly.fascia && a.dataInizio!.startsWith(P.anomaly.month);
    const ratio = rrEnd((a) => a.recuperatore === 'FIDES') / rrEnd((a) => a.recuperatore === 'PHONICA' && !anomalous(a));
    expect(ratio).toBeGreaterThan(1.1);
    expect(ratio).toBeLessThan(1.3);
    expect(P.collectorEffect.FIDES! / P.collectorEffect.PHONICA!).toBeCloseTo(1.2, 10);
  });
  it('calo anomalo: PHONICA 1P nel mese indicato recupera molto meno dei mesi vicini', () => {
    const a = P.anomaly;
    const month = (m: string) => valid.filter((x) => x.recuperatore === a.collector && x.fasciaAffido === a.fascia && x.dataInizio!.startsWith(m));
    const anomalous = computeKpi('RR_END', month(a.month), ds.asOf).value!;
    const around = computeKpi('RR_END', [...month('2025-05'), ...month('2025-07')], ds.asOf).value!;
    expect(anomalous).toBeLessThan(around * 0.6);
  });
  it('CRIBIS in 3P ha pochi affidi (dati insufficienti nel volume minimo)', () => {
    const { valid: last12 } = prepareAffidi(ds);
    expect(last12.filter((a) => a.recuperatore === 'CRIBIS' && a.fasciaAffido === '3P').length).toBeLessThan(30);
  });
});

describe('generatore: durata variabile, avvisi e indice atteso', () => {
  it('la durata varia per affido nell\'intervallo e RR_180 e RR_END non coincidono', () => {
    const { min, max } = P.durationRange;
    const done = ds.affidi.filter((a) => a.dataInizio && a.dataFine);
    const durations = done.map((a) => (Date.parse(a.dataFine!) - Date.parse(a.dataInizio!)) / 86_400_000);
    expect(Math.min(...durations)).toBeGreaterThanOrEqual(min);
    expect(Math.max(...durations)).toBeLessThanOrEqual(max);
    expect(new Set(durations).size).toBeGreaterThan(50);
    const { valid } = prepareAffidi(ds, { from: '2024-10-01', to: '2026-09-30' });
    expect(computeKpi('RR_180', valid, ds.asOf).value).not.toBeCloseTo(computeKpi('RR_END', valid, ds.asOf).value!, 3);
  });
  it('prepareAffidi segnala i conclusi senza data fine', () => {
    const { flagged } = prepareAffidi(ds, { from: '2024-10-01', to: '2026-09-30' });
    // gli affidi sporchi sono su insiemi disgiunti: tutti i 15 restano validi
    expect(flagged).toEqual({ CLOSED_WITHOUT_END_DATE: P.dirty.openCaseWithoutEndDate });
  });
  it('indice atteso: FIDES ~1.2, ordine dei recuperatori coerente con gli effetti', () => {
    expect(EXPECTED_INDEX.byCollector.FIDES).toBeGreaterThan(1.15);
    expect(EXPECTED_INDEX.byCollector.FIDES).toBeLessThan(1.25);
    expect(EXPECTED_INDEX.byCollector.TELECOM).toBeLessThan(EXPECTED_INDEX.byCollector.CRIBIS!);
    expect(EXPECTED_INDEX.byCollector.CRIBIS).toBeLessThan(EXPECTED_INDEX.byCollector.PHONICA!);
  });
});
