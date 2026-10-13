import { DEFAULT_CORS_ORIGIN, type MockOptions } from './app.ts';

export interface MockConfig extends MockOptions {
  port: number;
}

/** Default del profilo "ui": CORS attivo e ritardo realistico tra gli eventi. */
export const UI_PROFILE = { port: 8080, eventDelayMs: 300, cors: true } as const;

const bool = (v: string | undefined, def: boolean): boolean => (v === undefined || v === '' ? def : /^(1|true|yes|on)$/i.test(v));

function int(name: string, v: string | undefined, def: number | undefined): number | undefined {
  if (v === undefined || v === '') return def;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} deve essere un intero >= 0 (ricevuto "${v}")`);
  return n;
}

/**
 * Configurazione dell'avvio: profilo (`--profile ui` o MOCK_PROFILE=ui) + variabili d'ambiente.
 * Le variabili hanno sempre la precedenza sui default del profilo.
 */
export function resolveConfig(argv: string[], env: Record<string, string | undefined>): MockConfig {
  const i = argv.indexOf('--profile');
  const profile = (i >= 0 ? argv[i + 1] : undefined) ?? env.MOCK_PROFILE ?? '';
  if (profile !== '' && profile !== 'ui') throw new Error(`Profilo sconosciuto: "${profile}" (disponibile: ui)`);
  const base = profile === 'ui' ? UI_PROFILE : { port: 8080, eventDelayMs: 0, cors: false };
  const config: MockConfig = {
    port: int('PORT', env.PORT, base.port)!,
    eventDelayMs: int('MOCK_EVENT_DELAY_MS', env.MOCK_EVENT_DELAY_MS, base.eventDelayMs),
    cors: bool(env.MOCK_CORS, base.cors),
    corsOrigin: env.MOCK_CORS_ORIGIN || DEFAULT_CORS_ORIGIN,
  };
  const drop = int('MOCK_DROP_AFTER_EVENTS', env.MOCK_DROP_AFTER_EVENTS, undefined);
  if (drop !== undefined) config.dropAfterEvents = drop;
  return config;
}
