import { get_case_timeline } from './case.ts';
import { get_kpi_catalog, list_collectors } from './context.ts';
import { compare_collectors, get_collector_performance, rank_collectors_by_band } from './performance.ts';
import { get_portfolio_distribution, get_portfolio_summary, get_recovery_trend } from './portfolio.ts';
import type { ToolHandler } from './types.ts';

/**
 * Tool implementati da questo server (D-42: nessun tool controfattuale).
 * Nome, descrizione e schemi vengono da contracts/schemas/tools: qui solo il calcolo.
 */
export const HANDLERS: Record<string, ToolHandler> = {
  get_kpi_catalog,
  list_collectors,
  get_portfolio_summary,
  get_recovery_trend,
  get_portfolio_distribution,
  get_collector_performance,
  compare_collectors,
  rank_collectors_by_band,
  get_case_timeline,
};
