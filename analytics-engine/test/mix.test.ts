import { describe, expect, it } from 'vitest';
import {
  EXPECTED_INDEX,
  analyzeCollectors,
  createRng,
  generateDataset,
  getCollectorPerformance,
  rankCollectorsByBand,
  separationRanks,
  wilsonInterval,
  type Affido,
  type Dataset,
} from '../src/index.ts';
import { expectValidToolOutput } from './helpers.ts';

const ds = generateDataset();
const RESAMPLES = 400; // veloce; il default (1000) e coperto da un solo test

describe('wilsonInterval', () => {
  it('valori noti al 90%', () => {
    const [lo, hi] = wilsonInterval(50, 100);
    expect(lo).toBeCloseTo(0.4188, 3);
    expect(hi).toBeCloseTo(0.5812, 3);
    expect(wilsonInterval(0, 10)[0]).toBe(0);
    expect(wilsonInterval(10, 10)[1]).toBe(1);
  });
});

describe('correzione per mix', () => {
  // Due recuperatori con la stessa resa per segmento (classe) e mix opposto: dopo la correzione l'indice e ~1.
  const scope = { from: '2026-01-01', to: '2026-06-30' };
  function synthetic(): Dataset {
    const rng = createRng(7);
    const rate: Record<string, number> = { '<5k': 0.4, '>20k': 0.1 };
    const affidi: Affido[] = [];
    const add = (rec: string, classe: string, n: number) => {
      for (let i = 0; i < n; i++) {
        const expo = 1000;
        affidi.push({
          idAffido: `${rec}-${classe}-${i}`, pratica: `${rec}-${classe}-${i}`, recuperatore: rec, fasciaAffido: '1P',
          dataInizio: '2026-01-10', dataFine: null, esposizioneIniziale: expo,
          segmento: { prodotto: 'PERSONALE', classeEsposizione: classe, classificazione: 'UTP', regione: 'LAZIO' },
          incassi: [{ data: '2026-02-01', importo: expo * rate[classe]! * (0.8 + 0.4 * rng()) }], esito: 'IN_CORSO', provvigioni: null,
        });
      }
    };
    add('EASY', '<5k', 270);
    add('EASY', '>20k', 30);
    add('HARD', '<5k', 30);
    add('HARD', '>20k', 270);
    return { asOf: '2026-06-30', seed: 0, affidi, incassiSenzaAffido: [] };
  }

  it('stessa resa, mix diverso: indice ~1 con IC che comprende 1, mentre senza correzione i due differiscono molto', () => {
    const d = synthetic();
    const adj = analyzeCollectors(d, { resamples: RESAMPLES, scope });
    for (const c of ['EASY', 'HARD']) {
      const r = adj.rows.find((x) => x.collector === c && x.fascia === '1P')!;
      expect(r.index).toBeGreaterThan(0.97);
      expect(r.index).toBeLessThan(1.03);
      expect(r.indexCi![0]).toBeLessThanOrEqual(1);
      expect(r.indexCi![1]).toBeGreaterThanOrEqual(1);
      expect(r.label).toBe('IN_LINE');
    }
    const raw = analyzeCollectors(d, { resamples: RESAMPLES, mixAdjusted: false, scope });
    expect(raw.rows.find((x) => x.collector === 'EASY' && x.fascia === '1P')!.index!).toBeGreaterThan(1.3);
    expect(raw.rows.find((x) => x.collector === 'HARD' && x.fascia === '1P')!.index!).toBeLessThan(0.7);
  });

  it('accorpa i segmenti sotto soglia: con soglia enorme il benchmark e quello della sola fascia', () => {
    const d = synthetic();
    const pooled = analyzeCollectors(d, { resamples: 50, segmentMinN: 1_000_000, scope });
    const flat = analyzeCollectors(d, { resamples: 50, mixAdjusted: false, scope });
    expect(pooled.rows.map((r) => r.index)).toEqual(flat.rows.map((r) => r.index));
  });
});

describe('dataset sintetico di default', () => {
  const a = analyzeCollectors(ds, { resamples: RESAMPLES });
  const row = (c: string, f: string | null) => a.rows.find((r) => r.collector === c && r.fascia === f)!;

  it("FIDES: l'IC 90% dell'indice contiene l'atteso, globale e per fascia", () => {
    const g = row('FIDES', null);
    expect(g.indexCi![0]).toBeLessThanOrEqual(EXPECTED_INDEX.byCollector.FIDES!);
    expect(g.indexCi![1]).toBeGreaterThanOrEqual(EXPECTED_INDEX.byCollector.FIDES!);
    expect(g.index!).toBeGreaterThan(1.1);
    for (const f of ['1P', '2P', '3P']) {
      const r = row('FIDES', f);
      const exp = EXPECTED_INDEX.byCollectorFascia[f]!.FIDES!;
      expect(r.indexCi![0]).toBeLessThanOrEqual(exp);
      expect(r.indexCi![1]).toBeGreaterThanOrEqual(exp);
    }
  });

  it("TELECOM (mix piu difficile): l'IC contiene l'atteso (~0.87)", () => {
    const g = row('TELECOM', null);
    expect(g.indexCi![0]).toBeLessThanOrEqual(EXPECTED_INDEX.byCollector.TELECOM!);
    expect(g.indexCi![1]).toBeGreaterThanOrEqual(EXPECTED_INDEX.byCollector.TELECOM!);
  });

  it('etichette globali: FIDES ABOVE, TELECOM BELOW', () => {
    expect(row('FIDES', null).label).toBe('ABOVE');
    expect(row('TELECOM', null).label).toBe('BELOW');
  });

  it('stesso seed, stessi intervalli; seed diverso, intervalli diversi', () => {
    expect(analyzeCollectors(ds, { resamples: RESAMPLES }).rows).toEqual(a.rows);
    const c = analyzeCollectors(ds, { resamples: RESAMPLES, seed: 1 });
    expect(c.rows[0]!.indexCi).not.toEqual(a.rows[0]!.indexCi);
    expect(c.rows[0]!.index).toBe(a.rows[0]!.index); // la stima puntuale non dipende dal seed
  });

  it('il default (1000 ricampionamenti) resta veloce', () => {
    const t = Date.now();
    expect(analyzeCollectors(ds).resamples).toBe(1000);
    expect(Date.now() - t).toBeLessThan(5000);
  });
});

describe('get_collector_performance (KAN-37)', () => {
  const out = getCollectorPerformance(ds, { resamples: RESAMPLES });
  it('valido contro lo schema, con ci/index/indexCi/label e seed in meta', () => {
    expectValidToolOutput('get_collector_performance', out);
    expect(out.meta.seed).toBe(20261013);
    const fides = out.cells.find((c) => c.collector === 'FIDES' && c.fascia === '1P')!;
    expect(fides.ci![0]).toBeLessThan(fides.value!);
    expect(fides.ci![1]).toBeGreaterThan(fides.value!);
    expect(fides.label).toBe('ABOVE');
  });
  it('CRIBIS in 3P: dati insufficienti, senza intervalli ne indice', () => {
    const c = out.cells.find((x) => x.collector === 'CRIBIS' && x.fascia === '3P')!;
    expect(c.label).toBe('INSUFFICIENT_DATA');
    expect(c.index).toBeUndefined();
    expect(c.ci).toBeUndefined();
    expect(c.indexCi).toBeUndefined();
  });
  it('tasso su conteggi (PAY_RATE): intervallo di Wilson sul valore', () => {
    const r = getCollectorPerformance(ds, { kpi: 'PAY_RATE', resamples: 50 });
    const c = r.cells.find((x) => x.collector === 'FIDES' && x.fascia === '1P')!;
    expect(c.ci).toEqual(wilsonInterval(Math.round(c.value! * c.n), c.n));
    expectValidToolOutput('get_collector_performance', r);
  });
});

describe('rank_collectors_by_band', () => {
  const out = rankCollectorsByBand(ds, { resamples: RESAMPLES });
  it('valido contro lo schema', () => {
    expectValidToolOutput('rank_collectors_by_band', out);
    expect(out.meta.tool).toBe('rank_collectors_by_band');
    expect(out.bands.map((b) => b.fascia)).toEqual(['1P', '2P', '3P']);
  });
  it('ordinata per limite inferiore; FIDES prima e ABOVE, TELECOM BELOW in ogni fascia', () => {
    for (const b of out.bands) {
      const los = b.ranking.filter((r) => r.label !== 'INSUFFICIENT_DATA').map((r) => r.ci![0]);
      expect(los).toEqual([...los].sort((x, y) => y - x));
      expect(b.ranking[0]).toMatchObject({ collector: 'FIDES', label: 'ABOVE' });
      expect(b.ranking.find((r) => r.collector === 'TELECOM')!.label).toBe('BELOW');
    }
  });
  it('CRIBIS in 3P: INSUFFICIENT_DATA in coda, senza indice, fuori dai pari merito', () => {
    const b3 = out.bands.find((b) => b.fascia === '3P')!;
    const last = b3.ranking.at(-1)!;
    expect(last).toEqual({ collector: 'CRIBIS', n: last.n, label: 'INSUFFICIENT_DATA' });
    expect(last.n).toBeLessThan(30);
    expect(b3.ties.flat()).not.toContain('CRIBIS');
  });
  it('pari merito: ogni membro si sovrappone ad almeno un altro del gruppo; nessun recuperatore in due gruppi', () => {
    expect(out.bands.some((b) => b.ties.length > 0)).toBe(true);
    for (const b of out.bands) {
      for (const g of b.ties) {
        expect(g.length).toBeGreaterThanOrEqual(2);
        const items = g.map((c) => b.ranking.find((r) => r.collector === c)!);
        for (const it of items) {
          expect(items.some((o) => o !== it && o.ci![0] <= it.ci![1] && it.ci![0] <= o.ci![1])).toBe(true);
        }
      }
      expect(new Set(b.ties.flat()).size).toBe(b.ties.flat().length);
    }
  });
  it('caso a catena: A~B, B~C, A e C disgiunti hanno ranghi diversi', () => {
    const [a, b, c] = separationRanks([[2, 4], [3, 6], [5, 8]]);
    expect(a).not.toBe(c);
    expect(b).toBe(c); // B e C si sovrappongono e nessuno li separa
    expect(a).toBe(2);
  });
  it('2P di default: FIDES (ABOVE) e TELECOM (BELOW) non sono mai nello stesso gruppo', () => {
    const b2 = out.bands.find((b) => b.fascia === '2P')!;
    expect(b2.ties.some((g) => g.includes('FIDES') && g.includes('TELECOM'))).toBe(false);
  });
  it('ogni gruppo di pari merito: stesso rango per separazione e nessuna coppia con IC disgiunti', () => {
    for (const b of out.bands) {
      const withCi = b.ranking.filter((r) => r.ci);
      const ranks = separationRanks(withCi.map((r) => r.ci!));
      const rankOf = (c: string) => ranks[withCi.findIndex((r) => r.collector === c)]!;
      for (const g of b.ties) {
        expect(new Set(g.map(rankOf)).size).toBe(1);
        for (const x of g) for (const y of g) {
          const cx = withCi.find((r) => r.collector === x)!.ci!;
          const cy = withCi.find((r) => r.collector === y)!.ci!;
          expect(cx[0] <= cy[1] && cy[0] <= cx[1]).toBe(true);
        }
      }
    }
  });
  it('minSample alto: tutti INSUFFICIENT_DATA e nessun pari merito', () => {
    const r = rankCollectorsByBand(ds, { resamples: 20, minSample: 100000 });
    expectValidToolOutput('rank_collectors_by_band', r);
    expect(r.bands.every((b) => b.ties.length === 0 && b.ranking.every((x) => x.label === 'INSUFFICIENT_DATA'))).toBe(true);
  });
  it('KPI senza indice: errore', () => {
    expect(() => rankCollectorsByBand(ds, { kpi: 'COST_RATIO' })).toThrow();
  });
});

function hand(rec: string, classe: string, expo: number, paid: number, i: number): Affido {
  return {
    idAffido: `${rec}-${classe}-${i}`, pratica: `${rec}-${classe}-${i}`, recuperatore: rec, fasciaAffido: '1P',
    dataInizio: '2026-01-10', dataFine: null, esposizioneIniziale: expo,
    segmento: { prodotto: 'PERSONALE', classeEsposizione: classe, classificazione: 'UTP', regione: 'LAZIO' },
    incassi: paid > 0 ? [{ data: '2026-02-01', importo: paid }] : [], esito: 'IN_CORSO', provvigioni: null,
  };
}

describe('indice: calcolo a mano', () => {
  it('2 collector, 2 segmenti (RR_90)', () => {
    // Segmento S (<5k): X 2 affidi, esposizione 1000 e incasso 500 ciascuno; Y 1 affido, 1000 e 300.
    //   RR_S = (500+500+300) / (1000+1000+1000) = 1300/3000 = 0.43333
    // Segmento L (>20k): X 1 affido, 2000 e 400; Y 2 affidi, 2000 e 400 ciascuno.
    //   RR_L = (400+400+400) / (2000+2000+2000) = 1200/6000 = 0.2
    // X: reale = 500+500+400 = 1400; atteso = 2000*0.43333 + 2000*0.2 = 866.667+400 = 1266.667; indice = 1.105263
    // Y: reale = 300+400+400 = 1100; atteso = 1000*0.43333 + 4000*0.2 = 433.333+800 = 1233.333; indice = 0.891892
    const affidi = [
      hand('X', '<5k', 1000, 500, 0), hand('X', '<5k', 1000, 500, 1), hand('X', '>20k', 2000, 400, 2),
      hand('Y', '<5k', 1000, 300, 0), hand('Y', '>20k', 2000, 400, 1), hand('Y', '>20k', 2000, 400, 2),
    ];
    const d: Dataset = { asOf: '2026-06-30', seed: 0, affidi, incassiSenzaAffido: [] };
    const a = analyzeCollectors(d, { minSample: 1, segmentMinN: 1, resamples: 20, scope: { from: '2026-01-01', to: '2026-06-30' } });
    const get = (c: string, f: string | null) => a.rows.find((r) => r.collector === c && r.fascia === f)!;
    for (const f of ['1P', null]) {
      expect(get('X', f).index).toBeCloseTo(1400 / (2000 * (1300 / 3000) + 400), 6);
      expect(get('X', f).index).toBeCloseTo(1.105263, 5);
      expect(get('Y', f).index).toBeCloseTo(0.891892, 5);
    }
    expect(get('X', '1P').value).toBeCloseTo(1400 / 4000, 9);
  });

  it('con n >= minSample ma atteso nullo: INSUFFICIENT_DATA, senza indice', () => {
    const affidi = Array.from({ length: 30 }, (_, i) => hand('Z', '<5k', 1000, 0, i)); // nessun incasso: benchmark 0
    const d: Dataset = { asOf: '2026-06-30', seed: 0, affidi, incassiSenzaAffido: [] };
    const a = analyzeCollectors(d, { resamples: 20, scope: { from: '2026-01-01', to: '2026-06-30' } });
    const r = a.rows.find((x) => x.collector === 'Z' && x.fascia === '1P')!;
    expect(r.n).toBe(30);
    expect(r.label).toBe('INSUFFICIENT_DATA');
    expect(r.index).toBeUndefined();
  });
});
