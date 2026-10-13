import {
  getPortfolioDistribution,
  getPortfolioSummary,
  getRecoveryTrend,
  type DistributionDimension,
  type DistributionMeasure,
  type Scope,
  type TrendGranularity,
  type TrendGroupBy,
  type TrendMeasure,
} from '../../../analytics-engine/src/index.ts';
import type { ToolHandler } from './types.ts';

/** Solo adattamento degli input validati: le aggregazioni sono in analytics-engine (src/portfolio.ts). */
export const get_portfolio_summary: ToolHandler = (ctx, input) => getPortfolioSummary(ctx.dataset, { scope: input.scope as Scope | undefined });

export const get_recovery_trend: ToolHandler = (ctx, input) =>
  getRecoveryTrend(ctx.dataset, {
    scope: input.scope as Scope | undefined,
    granularity: input.granularity as TrendGranularity | undefined,
    groupBy: input.groupBy as TrendGroupBy | undefined,
    measure: input.measure as TrendMeasure | undefined,
  });

export const get_portfolio_distribution: ToolHandler = (ctx, input) => ({
  ...getPortfolioDistribution(ctx.dataset, {
    scope: input.scope as Scope | undefined,
    dimension: input.dimension as DistributionDimension,
    measure: input.measure as DistributionMeasure | undefined,
  }),
  dataSourceId: ctx.dataSourceId,
});
