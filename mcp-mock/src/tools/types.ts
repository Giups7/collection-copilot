import type { Dataset } from '../../../analytics-engine/src/index.ts';

export interface ToolContext {
  dataset: Dataset;
  /** Identificativo della fonte dati (dataset sintetico + seed), riportato come `dataSourceId` dove il contratto lo prevede. */
  dataSourceId: string;
}

export type ToolHandler = (ctx: ToolContext, input: Record<string, unknown>) => unknown;

/** Errore atteso del chiamante (input non calcolabile): diventa un errore MCP leggibile, non un guasto del server. */
export class ToolError extends Error {}
