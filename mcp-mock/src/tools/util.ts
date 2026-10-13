import { COMPUTABLE_KPIS, type ComputableKpi, type PreparedAffidi } from '../../../analytics-engine/src/index.ts';
import { ToolError } from './types.ts';

export function requireKpi(code: unknown): ComputableKpi {
  if (!(COMPUTABLE_KPIS as readonly string[]).includes(code as string)) {
    throw new ToolError(`KPI "${String(code)}" non calcolabile su questo dataset (nel catalogo ha available=false: dati non presenti).`);
  }
  return code as ComputableKpi;
}

/** `meta` comune agli output (contracts/schemas/common/meta.schema.json): fonte = asOf + seed del dataset. */
export function metaFor(
  tool: string,
  asOf: string,
  seed: number,
  prep: Pick<PreparedAffidi, 'scope' | 'excluded'>,
  extra: Record<string, unknown> = {},
) {
  const total = Object.values(prep.excluded).reduce((s, v) => s + v, 0);
  return { tool, asOf, scope: prep.scope, ...extra, excluded: { total, byReason: prep.excluded }, seed };
}
