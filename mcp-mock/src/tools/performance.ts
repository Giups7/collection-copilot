import { computeKpi, prepareAffidi, type Scope } from '../../../analytics-engine/src/index.ts';
import type { ToolHandler } from './types.ts';
import { collectorPerformance, compareIndex, rankByBand } from './rank.ts';
import { metaFor, requireKpi } from './util.ts';

const MIN_SAMPLE_DEFAULT = 30;

function performanceRequest(input: Record<string, unknown>) {
  return {
    scope: input.scope as Scope | undefined,
    kpi: requireKpi(input.kpi ?? 'RR_90'),
    mixAdjusted: (input.mixAdjusted as boolean | undefined) ?? true,
    minSample: (input.minSample as number | undefined) ?? MIN_SAMPLE_DEFAULT,
  };
}

export const get_collector_performance: ToolHandler = (ctx, input) => ({
  ...collectorPerformance(ctx.dataset, performanceRequest(input)),
  dataSourceId: ctx.dataSourceId,
});

export const rank_collectors_by_band: ToolHandler = (ctx, input) => rankByBand(ctx.dataset, performanceRequest(input));

export const compare_collectors: ToolHandler = (ctx, input) => {
  const { dataset } = ctx;
  const fascia = input.fascia as string;
  const collectors = input.collectors as string[];
  const kpis = ((input.kpis as string[] | undefined) ?? ['RR_90', 'CURE_RATE', 'FIRST_PAY_DAYS']).map(requireKpi);
  const mixAdjusted = (input.mixAdjusted as boolean | undefined) ?? true;
  const scope: Scope = { ...(input.scope as Scope | undefined), fasce: [fascia], collectors };
  const prep = prepareAffidi(dataset, scope);
  const minSample = MIN_SAMPLE_DEFAULT;
  const indexFor = new Map(kpis.map((kpi) => [kpi, compareIndex(dataset, { scope: input.scope as Scope | undefined, fascia, kpi, mixAdjusted, minSample })]));

  const rows = collectors.map((collector) => {
    const affidi = prep.valid.filter((a) => a.recuperatore === collector);
    return {
      collector,
      n: affidi.length,
      insufficient: affidi.length < minSample,
      metrics: kpis.map((kpi) => ({
        kpi,
        value: computeKpi(kpi, affidi, dataset.asOf).value,
        ...indexFor.get(kpi)!(collector),
      })),
    };
  });

  return {
    meta: metaFor('compare_collectors', dataset.asOf, dataset.seed, prep, { n: prep.valid.length }),
    fascia,
    rows,
  };
};
