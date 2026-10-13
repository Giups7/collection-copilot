import { createHash } from 'node:crypto';
import type { Affido } from '../../../analytics-engine/src/index.ts';
import { ToolError, type ToolHandler } from './types.ts';

interface Event {
  date: string;
  kind: 'ASSIGNMENT_START' | 'ASSIGNMENT_END' | 'PAYMENT' | 'BAND_CHANGE';
  description: string;
  collector?: string;
  amount?: number;
}

const KIND_ORDER = ['ASSIGNMENT_START', 'PAYMENT', 'BAND_CHANGE', 'ASSIGNMENT_END'];
const eur = (x: number) => x.toFixed(2);

/** Riferimento pseudonimizzato e deterministico (seed + pratica): il codice reale della pratica non esce dal server. */
const pseudonym = (seed: number, pratica: string) => `PR-${createHash('sha256').update(`${seed}:${pratica}`).digest('hex').slice(0, 10).toUpperCase()}`;

export const get_case_timeline: ToolHandler = (ctx, input) => {
  const { dataset } = ctx;
  const ref = (input.caseRef as string).trim().toUpperCase();
  const seen = new Set<string>();
  const affidi: Affido[] = dataset.affidi
    .filter((a) => a.pratica.toUpperCase() === ref && !seen.has(a.idAffido) && seen.add(a.idAffido))
    .sort((a, b) => (a.dataInizio ?? '').localeCompare(b.dataInizio ?? ''));
  if (affidi.length === 0) {
    throw new ToolError(`Pratica "${String(input.caseRef)}" non trovata nel dataset sintetico (formato atteso, es. P000123).`);
  }

  const events: Event[] = [];
  affidi.forEach((a, i) => {
    if (a.dataInizio) {
      events.push({
        date: a.dataInizio,
        kind: 'ASSIGNMENT_START',
        description: `Affido a ${a.recuperatore} in fascia ${a.fasciaAffido ?? 'non ricostruibile'}${a.esposizioneIniziale ? `, esposizione ${eur(a.esposizioneIniziale)} EUR` : ''}.`,
        collector: a.recuperatore,
      });
      const next = affidi[i + 1];
      if (next?.dataInizio && next.fasciaAffido !== a.fasciaAffido) {
        events.push({ date: next.dataInizio, kind: 'BAND_CHANGE', description: `Cambio fascia da ${a.fasciaAffido ?? 'n/d'} a ${next.fasciaAffido ?? 'n/d'}.` });
      }
    }
    for (const p of a.incassi) {
      events.push({ date: p.data, kind: 'PAYMENT', description: `Incasso di ${eur(p.importo)} EUR${p.importo < 0 ? ' (importo negativo: dato anomalo)' : ''}.`, collector: a.recuperatore, amount: p.importo });
    }
    if (a.dataFine) {
      events.push({ date: a.dataFine, kind: 'ASSIGNMENT_END', description: `Fine affido, esito ${a.esito}.`, collector: a.recuperatore });
    }
  });
  events.sort((x, y) => x.date.localeCompare(y.date) || KIND_ORDER.indexOf(x.kind) - KIND_ORDER.indexOf(y.kind));

  return {
    meta: { tool: 'get_case_timeline', asOf: dataset.asOf, scope: {}, n: affidi.length, seed: dataset.seed },
    caseRef: pseudonym(dataset.seed, affidi[0]!.pratica),
    events,
  };
};
