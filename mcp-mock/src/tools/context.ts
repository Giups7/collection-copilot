import { getKpiCatalog, prepareAffidi, type Scope } from '../../../analytics-engine/src/index.ts';
import type { ToolHandler } from './types.ts';
import { metaFor } from './util.ts';

export const get_kpi_catalog: ToolHandler = () => getKpiCatalog();

/** Anagrafica del mock: nome esteso e nomi alternativi (il dataset contiene solo i codici). */
const DIRECTORY: Record<string, { name: string; aliases: string[] }> = {
  FIDES: { name: 'Fides', aliases: ['Fides Recuperi'] },
  PHONICA: { name: 'Phonica', aliases: ['Phonica Credit'] },
  TELECOM: { name: 'Telecom Recuperi', aliases: ['Telecom'] },
  CRIBIS: { name: 'Cribis', aliases: ['Cribis Collection'] },
  NOVARECO: { name: 'Novareco', aliases: ['Nova Reco'] },
};

export const list_collectors: ToolHandler = (ctx, input) => {
  const prep = prepareAffidi(ctx.dataset, input.scope as Scope | undefined);
  const fasce = new Map<string, Set<string>>();
  for (const a of prep.valid) (fasce.get(a.recuperatore) ?? fasce.set(a.recuperatore, new Set()).get(a.recuperatore)!).add(a.fasciaAffido!);
  // Attivo = ha almeno un affido in corso ad asOf (sull'intero dataset, non solo sul perimetro richiesto).
  const active = new Set(ctx.dataset.affidi.filter((a) => a.esito === 'IN_CORSO').map((a) => a.recuperatore));
  return {
    meta: metaFor('list_collectors', ctx.dataset.asOf, ctx.dataset.seed, prep, { n: prep.valid.length }),
    collectors: [...fasce.keys()].sort().map((code) => ({
      code,
      name: DIRECTORY[code]?.name ?? code,
      fasce: [...fasce.get(code)!].sort(),
      active: active.has(code),
      ...(DIRECTORY[code] && { aliases: DIRECTORY[code].aliases }),
    })),
  };
};
