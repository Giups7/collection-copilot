import { describe, expect, it } from 'vitest';
import { computeKpi, getCollectorPerformance, getKpiCatalog, prepareAffidi, type Affido, type Dataset } from '../src/index.ts';
import { expectValidToolOutput } from './helpers.ts';

/**
 * Dataset scritto a mano; asOf 2026-06-30, quindi scope di default 2025-07-01 .. 2026-06-30.
 * I valori attesi nei test sono calcolati a mano (vedi i commenti), non con le funzioni sotto test.
 */
const seg = { prodotto: 'PERSONALE', classeEsposizione: '<5k', classificazione: 'UTP', regione: 'LOMBARDIA' };
function aff(id: string, o: Partial<Affido> & Pick<Affido, 'recuperatore' | 'dataInizio' | 'esposizioneIniziale'>): Affido {
  return {
    idAffido: id,
    pratica: id,
    fasciaAffido: '1P',
    dataFine: null,
    segmento: seg,
    incassi: [],
    esito: 'IN_CORSO',
    provvigioni: 0,
    ...o,
  };
}

const A1 = aff('A1', {
  recuperatore: 'ALFA', dataInizio: '2026-01-01', dataFine: '2026-04-01', esposizioneIniziale: 1000, esito: 'REGOLARIZZATA',
  incassi: [{ data: '2026-01-11', importo: 300 }, { data: '2026-02-20', importo: 400 }], provvigioni: 70, // giorni 10 e 50
});
const A2 = aff('A2', {
  recuperatore: 'ALFA', dataInizio: '2026-01-01', dataFine: '2026-06-01', esposizioneIniziale: 2000, esito: 'CHIUSA',
  incassi: [{ data: '2026-03-02', importo: 600 }, { data: '2026-05-01', importo: 200 }], provvigioni: 90, // giorni 60 e 120
});
const A3 = aff('A3', {
  recuperatore: 'ALFA', dataInizio: '2026-01-01', dataFine: '2026-04-01', esposizioneIniziale: 3000, esito: 'RESTITUITA',
});
const A4 = aff('A4', {
  recuperatore: 'ALFA', dataInizio: '2026-05-01', esposizioneIniziale: 4000, // in corso, 60 giorni di osservazione
  incassi: [{ data: '2026-05-21', importo: 500 }], provvigioni: 50,
});
const A5 = aff('A5', { recuperatore: 'ALFA', dataInizio: '2026-06-15', esposizioneIniziale: 5000 }); // 15 giorni di osservazione
const A12 = aff('A12', { // concluso ma senza dataFine: segnalato, non escluso
  recuperatore: 'ALFA', dataInizio: '2026-01-01', esposizioneIniziale: 1000, esito: 'CHIUSA',
  incassi: [{ data: '2026-01-21', importo: 100 }], provvigioni: 10,
});
const C1 = aff('C1', {
  recuperatore: 'ALFA', fasciaAffido: '2P', dataInizio: '2026-03-01', dataFine: '2026-06-01', esposizioneIniziale: 1000, esito: 'CHIUSA',
  incassi: [{ data: '2026-03-31', importo: 200 }], provvigioni: 20,
});
const B1 = aff('B1', {
  recuperatore: 'BETA', dataInizio: '2026-02-01', dataFine: '2026-05-02', esposizioneIniziale: 2000, esito: 'REGOLARIZZATA',
  incassi: [{ data: '2026-02-06', importo: 1000 }, { data: '2026-03-03', importo: 500 }], provvigioni: 150, // giorni 5 e 30
});
const B2 = aff('B2', {
  recuperatore: 'BETA', dataInizio: '2026-02-01', dataFine: '2026-05-02', esposizioneIniziale: 1000, esito: 'FASCIA_SUCCESSIVA',
});
// dati sporchi (ognuno con un motivo diverso) e fuori scope
const D_NOEXP = aff('D1', { recuperatore: 'ALFA', dataInizio: '2026-02-01', esposizioneIniziale: null });
const D_NEGEXP = aff('D1b', { recuperatore: 'BETA', dataInizio: '2026-02-01', esposizioneIniziale: -500 });
const D_NOSTART = aff('D2', { recuperatore: 'ALFA', dataInizio: null, esposizioneIniziale: 1000 });
const D_NEGPAY = aff('D3', {
  recuperatore: 'ALFA', dataInizio: '2026-02-01', esposizioneIniziale: 1000, incassi: [{ data: '2026-02-11', importo: -50 }],
});
const D_DUP = structuredClone(A1);
const D_NOBAND = aff('D4', { recuperatore: 'ALFA', fasciaAffido: null, dataInizio: '2026-02-01', esposizioneIniziale: 1000 });
const OUT_OF_SCOPE = aff('Z1', { recuperatore: 'ALFA', dataInizio: '2025-03-01', esposizioneIniziale: 9999 });

const dataset: Dataset = {
  asOf: '2026-06-30',
  seed: 0,
  affidi: [A1, A2, A3, A4, A5, A12, C1, B1, B2, D_NOEXP, D_NEGEXP, D_NOSTART, D_NEGPAY, D_DUP, D_NOBAND, OUT_OF_SCOPE],
  incassiSenzaAffido: [
    { pratica: 'X1', recuperatore: 'ALFA', data: '2026-03-01', importo: 100 },
    { pratica: 'X2', recuperatore: 'BETA', data: '2025-12-01', importo: 100 },
    { pratica: 'X3', recuperatore: 'BETA', data: '2025-01-01', importo: 100 }, // fuori periodo
  ],
};

const alfa1P = [A1, A2, A3, A4, A5, A12];
const ASOF = dataset.asOf;

describe('controlli di qualita', () => {
  it('esclude e conta per motivo, rispettando lo scope', () => {
    const p = prepareAffidi(dataset);
    expect(p.scope).toEqual({ from: '2025-07-01', to: '2026-06-30' });
    expect(p.flagged).toEqual({ CLOSED_WITHOUT_END_DATE: 1 }); // A12
    expect(p.excluded).toEqual({
      MISSING_START_DATE: 1, // D2
      NO_INITIAL_EXPOSURE: 2, // D1 (null), D1b (negativa)
      OVERLAPPING_ASSIGNMENTS: 1, // copia di A1
      BAND_UNKNOWN: 1, // D4
      INVALID_PAYMENT: 1, // D3
      PAYMENT_WITHOUT_ASSIGNMENT: 2, // X1, X2 (X3 e fuori periodo)
    });
    expect(p.valid.map((a) => a.idAffido).sort()).toEqual(['A1', 'A12', 'A2', 'A3', 'A4', 'A5', 'B1', 'B2', 'C1']);
  });

  it('applica i filtri di scope', () => {
    const p = prepareAffidi(dataset, { collectors: ['BETA'], from: '2026-02-01', to: '2026-02-28' });
    expect(p.valid.map((a) => a.idAffido)).toEqual(['B1', 'B2']);
    expect(p.excluded).toEqual({ NO_INITIAL_EXPOSURE: 1, MISSING_START_DATE: 1 });
  });
});

describe('KPI su ALFA fascia 1P (6 affidi, esposizione 16000, incassi 2100, provvigioni 220)', () => {
  const k = (code: Parameters<typeof computeKpi>[0]) => computeKpi(code, alfa1P, ASOF);

  it('RR_30: 5 affidi maturi (A5 no), esposizione 11000, incassi entro 30 giorni 300+500+100=900', () => {
    const r = k('RR_30');
    expect(r.value).toBeCloseTo(900 / 11000, 10);
    expect([r.n, r.exposure, r.excluded]).toEqual([5, 11000, { IMMATURE_WINDOW: 1 }]);
  });
  it('RR_60: stessi 5 affidi, incassi entro 60 giorni 700+600+500+100=1900 (A4 ha 60 giorni esatti)', () => {
    const r = k('RR_60');
    expect(r.value).toBeCloseTo(1900 / 11000, 10);
    expect(r.n).toBe(5);
  });
  it('RR_90: 4 affidi maturi (A1, A2, A3, A12), esposizione 7000, incassi 700+600+100=1400', () => {
    const r = k('RR_90');
    expect(r.value).toBeCloseTo(0.2, 10);
    expect([r.n, r.exposure, r.excluded]).toEqual([4, 7000, { IMMATURE_WINDOW: 2 }]);
  });
  it('RR_180: gli stessi 4 (A1 inizia 180 giorni prima di asOf), incassi 700+800+100=1600', () => {
    const r = k('RR_180');
    expect(r.value).toBeCloseTo(1600 / 7000, 10);
    expect(r.n).toBe(4);
  });
  it('RR_END: solo A1, A2, A3 (conclusi con dataFine), esposizione 6000, incassi 700+800=1500', () => {
    const r = k('RR_END');
    expect(r.value).toBeCloseTo(0.25, 10);
    expect([r.n, r.exposure, r.excluded]).toEqual([3, 6000, { IMMATURE_WINDOW: 2, END_DATE_MISSING: 1 }]);
  });
  it('CURE_RATE: 4 conclusi (A1, A2, A3, A12), 3 regolarizzati o chiusi', () => {
    const r = k('CURE_RATE');
    expect(r.value).toBe(0.75);
    expect([r.n, r.excluded]).toEqual([4, { NOT_CONCLUDED: 2 }]);
  });
  it('FIRST_PAY_DAYS: primi incassi a 10, 60, 20, 20 giorni -> mediana (20+20)/2', () => {
    const r = k('FIRST_PAY_DAYS');
    expect(r.value).toBe(20);
    expect([r.n, r.excluded]).toEqual([4, { NO_PAYMENT: 2 }]);
  });
  it('PAY_RATE: 4 affidi su 6 con incasso', () => {
    expect(k('PAY_RATE').value).toBeCloseTo(4 / 6, 10);
  });
  it('AVG_RECOVERED: 2100 / 6 = 350', () => {
    expect(k('AVG_RECOVERED').value).toBe(350);
  });
  it('RETURN_NO_PAY: 1 (A3) su 4 conclusi', () => {
    expect(k('RETURN_NO_PAY').value).toBe(0.25);
  });
  it('COST_RATIO: 220 / 2100', () => {
    expect(k('COST_RATIO').value).toBeCloseTo(220 / 2100, 10);
  });
  it('NET_RECOVERY: 2100 - 220 = 1880', () => {
    expect(k('NET_RECOVERY').value).toBe(1880);
  });
  it('senza provvigioni COST_RATIO e NET_RECOVERY escludono gli affidi e danno null', () => {
    const noComm = alfa1P.map((a) => ({ ...a, provvigioni: null }));
    const r = computeKpi('COST_RATIO', noComm, ASOF);
    expect([r.value, r.n, r.excluded]).toEqual([null, 0, { NO_COMMISSION: 6 }]);
  });
});

describe('KPI su BETA fascia 1P (B1, B2: esposizione 3000, incassi 1500, provvigioni 150)', () => {
  const beta = [B1, B2];
  it('valori calcolati a mano', () => {
    const v = (c: Parameters<typeof computeKpi>[0]) => computeKpi(c, beta, ASOF).value;
    expect(v('RR_90')).toBe(0.5); // inizio 2026-02-01 + 90 = 2026-05-02 <= asOf; incassi 1500 / 3000
    expect(v('RR_END')).toBe(0.5);
    expect(v('CURE_RATE')).toBe(0.5);
    expect(v('FIRST_PAY_DAYS')).toBe(5);
    expect(v('PAY_RATE')).toBe(0.5);
    expect(v('AVG_RECOVERED')).toBe(750);
    expect(v('RETURN_NO_PAY')).toBe(0.5);
    expect(v('COST_RATIO')).toBe(0.1);
    expect(v('NET_RECOVERY')).toBe(1350);
  });
});

describe('get_collector_performance', () => {
  it('RR_90 per recuperatore x fascia, esclusi per motivo, valido contro lo schema', () => {
    const out = getCollectorPerformance(dataset, { kpi: 'RR_90', minSample: 2 });
    expectValidToolOutput('get_collector_performance', out);
    expect(out.cells).toEqual([
      { collector: 'ALFA', fascia: '1P', n: 4, exposure: 7000, value: 0.2, label: 'IN_LINE' },
      { collector: 'ALFA', fascia: '2P', n: 1, exposure: 1000, value: 0.2, label: 'INSUFFICIENT_DATA' }, // C1: 2026-03-01 + 90 <= asOf
      { collector: 'BETA', fascia: '1P', n: 2, exposure: 3000, value: 0.5, label: 'IN_LINE' },
    ]);
    expect(out.meta).toMatchObject({
      tool: 'get_collector_performance',
      asOf: '2026-06-30',
      scope: { from: '2025-07-01', to: '2026-06-30' },
      kpi: 'RR_90',
      kpiVersion: '1.0',
      n: 7,
      excluded: {
        total: 10, // 1+2+1+1+1+2 (qualita) + 2 (finestra)
        byReason: {
          MISSING_START_DATE: 1,
          NO_INITIAL_EXPOSURE: 2,
          OVERLAPPING_ASSIGNMENTS: 1,
          BAND_UNKNOWN: 1,
          INVALID_PAYMENT: 1,
          PAYMENT_WITHOUT_ASSIGNMENT: 2,
          IMMATURE_WINDOW: 2, // A4, A5
        },
      },
    });
  });

  it('con minSample di default (30) tutte le celle sono dati insufficienti', () => {
    const out = getCollectorPerformance(dataset);
    expect(out.cells.every((c) => c.label === 'INSUFFICIENT_DATA')).toBe(true);
    expect(out.meta.kpi).toBe('RR_90');
  });
});

describe('get_kpi_catalog', () => {
  it('e valido contro lo schema e copre tutti i codici', () => {
    const cat = getKpiCatalog();
    expectValidToolOutput('get_kpi_catalog', cat);
    expect(cat.kpis.map((x) => x.code)).toEqual([
      'RR_30', 'RR_60', 'RR_90', 'RR_180', 'RR_END', 'CURE_RATE', 'FIRST_PAY_DAYS', 'PAY_RATE', 'AVG_RECOVERED',
      'RETURN_NO_PAY', 'PTP_KEPT', 'COST_RATIO', 'NET_RECOVERY',
    ]);
    expect(cat.kpis.find((x) => x.code === 'PTP_KEPT')?.available).toBe(false);
  });
  it('senza provvigioni COST_RATIO e NET_RECOVERY non sono disponibili', () => {
    const cat = getKpiCatalog({ commissionsAvailable: false });
    expect(cat.kpis.filter((x) => x.available === false).map((x) => x.code)).toEqual(['PTP_KEPT', 'COST_RATIO', 'NET_RECOVERY']);
  });
});
