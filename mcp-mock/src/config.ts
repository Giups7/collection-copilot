import { GENERATOR_PARAMS } from '../../analytics-engine/src/index.ts';

export interface Config {
  host: string;
  port: number;
  seed: number;
  /** Origini browser aggiuntive ammesse (oltre a http://127.0.0.1:<porta> e http://localhost:<porta>). */
  allowedOrigins: string[];
}

/** Variabili d'ambiente: MCP_MOCK_PORT (default 8090; 0 = porta casuale), MCP_MOCK_SEED (default: seed di analytics-engine). */
/** Variabile aggiuntiva: MCP_MOCK_ALLOWED_ORIGINS (origini separate da virgola). */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const num = (name: string, fallback: number): number => {
    const raw = env[name];
    if (raw === undefined || raw === '') return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0) throw new Error(`${name} deve essere un intero >= 0 (ricevuto "${raw}")`);
    return n;
  };
  // Solo localhost: l'autenticazione (On-Behalf-Of) arriva con E8.
  return {
    host: '127.0.0.1', port: num('MCP_MOCK_PORT', 8090), seed: num('MCP_MOCK_SEED', GENERATOR_PARAMS.defaultSeed),
    allowedOrigins: (env.MCP_MOCK_ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  };
}
