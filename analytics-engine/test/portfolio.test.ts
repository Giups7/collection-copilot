import { describe, expect, it } from 'vitest';
import { generateDataset, getPortfolioDistribution, getPortfolioSummary, getRecoveryTrend, type Affido, type Dataset } from '../src/index.ts';
import { expectValidToolOutput } from './helpers.ts';

/** Valori attesi calcolati a mano. Scope: 2026-01-01 .. 2026-03-31 (90 giorni); periodo precedente 2025-10-02 .. 2025-12-31. */
function aff(id: string, o: Partial<Affido> & Pick<Affido, 'recuperatore' | 'dataInizio' | 'esposizioneIniziale'>): Affido {
  return {
    idAffido: id,
    pratica: id,
    fasciaAffido: '1P',
    dataFine: null,
    segmento: { prodotto: 'PERSONALE', classeEsposizione: '<5k', classificazione: 'UTP', regione: 'LOMBARDIA' },
    incassi: [],
    esito: 'IN_CORSO',
    provvigioni: null,
    ...o,
  };
}
const dataset: Dataset = {
  asOf: '2026-06-30',
  seed: 7,
  affidi: [
    aff('P1', { recuperatore: 'ALFA', dataInizio: '2026-01-10', esposizioneIniziale: 1000, esito: 'REGOLARIZZATA', incassi: [{ data: '2026-02-01', importo: 300 }] }),
    aff('P2', { recuperatore: 'BETA', fasciaAffido: '2P', dataInizio: '2026-01-20', esposizioneIniziale: 2000, segmento: { prodotto: 'CARTA', classeEsposizione: '5-20k', classificazione: 'UTP', regione: 'LAZIO' } }),
    aff('P3', { recuperatore: 'ALFA', dataInizio: '2026-02-05', esposizioneIniziale: 3000, incassi: [{ data: '2026-03-01', importo: 600 }, { data: '2026-04-01', importo: 400 }] }),
    aff('P4', { recuperatore: 'BETA', dataInizio: '2026-03-15', esposizioneIniziale: 4000, incassi: [{ data: '2026-04-15', importo: 400 }] }),
    aff('P5', { recuperatore: 'ALFA', dataInizio: '2025-11-10', esposizioneIniziale: 2000, esito: 'CHIUSA', incassi: [{ data: '2025-12-10', importo: 500 }] }),
    aff('D1', { recuperatore: 'ALFA', dataInizio: '2026-02-01', esposizioneIniziale: null }),
  ],
  incassiSenzaAffido: [],
};
const scope = { from: '2026-01-01', to: '2026-03-31' };

describe('getPortfolioSummary', () => {
  it('totali, tassi e periodo precedente', () => {
    const r = getPortfolioSummary(dataset, { scope });
    expect(r).toMatchObject({ cases: 4, assignments: 4, activeAssignments: 3, exposure: 10000, recovered: 1700, recoveryRate: 0.17 });
    expect(r.previousPeriod).toEqual({ exposure: 2000, recovered: 500, recoveryRate: 0.25 });
    expect(r.meta).toMatchObject({ tool: 'get_portfolio_summary', asOf: '2026-06-30', seed: 7, n: 4, excluded: { total: 1, byReason: { NO_INITIAL_EXPOSURE: 1 } } });
    expectValidToolOutput('get_portfolio_summary', r);
  });

  it('perimetro vuoto: tasso 0, non NaN', () => {
    const r = getPortfolioSummary(dataset, { scope: { ...scope, collectors: ['NESSUNO'] } });
    expect(r).toMatchObject({ assignments: 0, exposure: 0, recoveryRate: 0 });
    expectValidToolOutput('get_portfolio_summary', r);
  });
});

describe('getRecoveryTrend', () => {
  it('incassato per coorte mensile e tasso', () => {
    const r = getRecoveryTrend(dataset, { scope });
    expect(r.periods).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(r.series).toEqual([{ name: 'Totale', values: [300, 1000, 400] }]);
    const rate = getRecoveryTrend(dataset, { scope, measure: 'RECOVERY_RATE' });
    expect(rate.series[0]!.values).toEqual([0.1, 1000 / 3000, 0.1]);
    expectValidToolOutput('get_recovery_trend', r);
    expectValidToolOutput('get_recovery_trend', rate);
  });

  it('per recuperatore, per trimestre; tasso null senza esposizione', () => {
    const byCollector = getRecoveryTrend(dataset, { scope, groupBy: 'COLLECTOR' });
    expect(byCollector.series).toEqual([
      { name: 'ALFA', values: [300, 1000, 0] },
      { name: 'BETA', values: [0, 0, 400] },
    ]);
    const rate = getRecoveryTrend(dataset, { scope, groupBy: 'COLLECTOR', measure: 'RECOVERY_RATE' });
    expect(rate.series[0]!.values[2]).toBeNull();
    const q = getRecoveryTrend(dataset, { scope, granularity: 'QUARTER' });
    expect(q.periods).toEqual(['2026-Q1']);
    expect(q.series[0]!.values).toEqual([1700]);
    expectValidToolOutput('get_recovery_trend', q);
    expectValidToolOutput('get_recovery_trend', rate);
  });
});

describe('getPortfolioDistribution', () => {
  it('valore e quota per categoria, ordinate per valore', () => {
    const r = getPortfolioDistribution(dataset, { scope, dimension: 'FASCIA', measure: 'EXPOSURE' });
    expect(r.items).toEqual([
      { category: '1P', value: 8000, share: 0.8 },
      { category: '2P', value: 2000, share: 0.2 },
    ]);
    const c = getPortfolioDistribution(dataset, { scope, dimension: 'COLLECTOR' });
    expect(c.items).toEqual([
      { category: 'ALFA', value: 2, share: 0.5 },
      { category: 'BETA', value: 2, share: 0.5 },
    ]);
    const p = getPortfolioDistribution(dataset, { scope, dimension: 'PRODUCT', measure: 'RECOVERED' });
    expect(p.items).toEqual([
      { category: 'PERSONALE', value: 1700, share: 1 },
      { category: 'CARTA', value: 0, share: 0 },
    ]);
    for (const x of [r, c, p]) expectValidToolOutput('get_portfolio_distribution', x);
  });

  it('dataset sintetico: le quote sommano a 1 per ogni dimensione', () => {
    const d = generateDataset();
    for (const dimension of ['FASCIA', 'PRODUCT', 'CLASSIFICATION', 'REGION', 'EXPOSURE_CLASS', 'COLLECTOR'] as const) {
      const r = getPortfolioDistribution(d, { dimension, measure: 'EXPOSURE' });
      expect(r.items.reduce((s, i) => s + i.share, 0)).toBeCloseTo(1, 9);
      expectValidToolOutput('get_portfolio_distribution', r);
    }
  });
});
