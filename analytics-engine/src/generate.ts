import { addDays, addMonthsFirstDay, daysInMonth, diffDays } from './dates.ts';
import { GENERATOR_PARAMS, type GeneratorParams } from './params.ts';
import { createRng, pickWeighted, shuffle, type Rng } from './prng.ts';
import type { Affido, Dataset, Esito, Incasso, IncassoSenzaAffido } from './types.ts';

const round2 = (x: number) => Math.round(x * 100) / 100;
const yyyymmdd = (iso: string) => iso.replaceAll('-', '');

function exposureFor(rng: Rng, classe: string): number {
  if (classe === '<5k') return round2(500 + rng() * 4500);
  if (classe === '5-20k') return round2(5000 + rng() * 15000);
  return round2(20000 + rng() * 30000);
}

/** Incassi (1-3) con tempi uguali per tutti i recuperatori: l'effetto del recuperatore e solo sull'importo. */
function makePayments(rng: Rng, duration: number, start: string, total: number): Incasso[] {
  const k = 1 + Math.floor(rng() * 3);
  const raw = Array.from({ length: k }, () => 0.2 + rng());
  const sum = raw.reduce((a, b) => a + b, 0);
  const out: Incasso[] = [];
  let left = total;
  for (let i = 0; i < k; i++) {
    const day = Math.min(duration, 1 + Math.floor(duration * rng() ** 1.6));
    const amount = i === k - 1 ? round2(left) : round2((total * raw[i]!) / sum);
    left -= amount;
    out.push({ data: addDays(start, day), importo: amount });
  }
  return out.filter((x) => x.importo > 0).sort((a, b) => a.data.localeCompare(b.data));
}

function pickEsito(rng: Rng, concluded: boolean, paid: number, exposure: number): Esito {
  const coin = rng();
  if (!concluded) return 'IN_CORSO';
  const frac = paid / exposure;
  if (frac >= 0.8) return 'REGOLARIZZATA';
  if (frac >= 0.5) return 'CHIUSA';
  if (paid === 0) return coin < 0.7 ? 'RESTITUITA' : 'FASCIA_SUCCESSIVA';
  return coin < 0.5 ? 'FASCIA_SUCCESSIVA' : 'RESTITUITA';
}

/** Genera il dataset sintetico degli affidi. Stesso seed e stessi parametri: stesso dataset. */
export function generateDataset(seed: number = GENERATOR_PARAMS.defaultSeed, p: GeneratorParams = GENERATOR_PARAMS): Dataset {
  const rng = createRng(seed);
  const clean: Affido[] = [];
  let counter = 0;

  for (let m = 0; m < p.months; m++) {
    const monthStart = addMonthsFirstDay(p.firstMonth, m);
    const dim = daysInMonth(monthStart);
    for (let i = 0; i < p.affidiPerMonth; i++) {
      const fascia = pickWeighted(rng, p.fasciaShare);
      const recuperatore = pickWeighted(rng, p.collectorShare[fascia]!);
      const prodotto = pickWeighted(rng, p.productShare);
      const classe = pickWeighted(rng, p.classMix[recuperatore] ?? p.defaultClassMix);
      const classificazione = pickWeighted(rng, p.classificazioneShare);
      const regione = pickWeighted(rng, p.regionShare);
      const esposizione = exposureFor(rng, classe);
      const dataInizio = addDays(monthStart, Math.floor(rng() * dim));
      const durata = p.durationRange.min + Math.floor(rng() * (p.durationRange.max - p.durationRange.min + 1));
      const dataFinePrevista = addDays(dataInizio, durata);
      const concluded = dataFinePrevista <= p.asOf;

      let mult = p.collectorEffect[recuperatore]! * p.classEffect[classe]! * p.productEffect[prodotto]!;
      const a = p.anomaly;
      if (recuperatore === a.collector && fascia === a.fascia && dataInizio.startsWith(a.month)) mult *= a.multiplier;
      const pays = rng() < p.payProbability[fascia]!;
      const noise = 0.85 + 0.3 * rng();
      const fraction = Math.min(1, p.meanRecoveredFraction[fascia]! * noise * mult);
      const total = pays ? round2(esposizione * fraction) : 0;
      const incassi = (total > 0 ? makePayments(rng, durata, dataInizio, total) : []).filter((x) => x.data <= p.asOf);
      const paid = round2(incassi.reduce((s, x) => s + x.importo, 0));
      const esito = pickEsito(rng, concluded, paid, esposizione);
      const pratica = `P${String(++counter).padStart(6, '0')}`;
      clean.push({
        idAffido: `${pratica}-${recuperatore}-${yyyymmdd(dataInizio)}`,
        pratica,
        recuperatore,
        fasciaAffido: fascia,
        dataInizio,
        dataFine: concluded ? dataFinePrevista : null,
        esposizioneIniziale: esposizione,
        segmento: { prodotto, classeEsposizione: classe, classificazione, regione },
        incassi,
        esito,
        provvigioni: round2(paid * p.commissionRate[recuperatore]!),
      });
    }
  }

  // Dati sporchi su insiemi disgiunti di affidi, in quantita note (p.dirty).
  const d = p.dirty;
  const order = shuffle(rng, clean.map((_, i) => i));
  const used = new Set<number>();
  const take = (n: number, eligible: (a: Affido) => boolean): number[] => {
    const picked: number[] = [];
    for (const idx of order) {
      if (picked.length === n) break;
      if (!used.has(idx) && eligible(clean[idx]!)) picked.push(idx);
    }
    if (picked.length < n) throw new Error('Dataset troppo piccolo per le quantita di dati sporchi richieste');
    picked.forEach((i) => used.add(i));
    return picked;
  };
  for (const i of take(d.missingStartDate, () => true)) clean[i]!.dataInizio = null;
  for (const i of take(d.missingExposure, () => true)) clean[i]!.esposizioneIniziale = null;
  for (const i of take(d.negativeExposure, () => true)) clean[i]!.esposizioneIniziale = -clean[i]!.esposizioneIniziale!;
  for (const i of take(d.missingFascia, () => true)) clean[i]!.fasciaAffido = null;
  for (const i of take(d.negativePayment, (a) => a.incassi.length > 0)) {
    const inc = clean[i]!.incassi[0]!;
    inc.importo = -inc.importo;
  }
  for (const i of take(d.openCaseWithoutEndDate, (a) => a.esito !== 'IN_CORSO')) clean[i]!.dataFine = null;
  const dupSources = new Set(take(d.duplicateRows, () => true));

  const affidi: Affido[] = [];
  clean.forEach((a, i) => {
    affidi.push(a);
    if (dupSources.has(i)) affidi.push(structuredClone(a));
  });

  const incassiSenzaAffido: IncassoSenzaAffido[] = [];
  const spanDays = diffDays(p.firstMonth, p.asOf);
  const names = Object.keys(p.collectorEffect);
  for (let i = 0; i < d.orphanPayments; i++) {
    incassiSenzaAffido.push({
      pratica: `X${String(i + 1).padStart(6, '0')}`,
      recuperatore: names[Math.floor(rng() * names.length)]!,
      data: addDays(p.firstMonth, Math.floor(rng() * (spanDays + 1))),
      importo: round2(100 + rng() * 2900),
    });
  }

  return { asOf: p.asOf, seed, affidi, incassiSenzaAffido };
}
