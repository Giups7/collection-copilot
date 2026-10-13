import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Contracts } from './contracts.ts';

export const DEFAULT_SCENARIOS_DIR = resolve(import.meta.dirname, '../scenarios');
export const DEFAULT_SCENARIO_ID = 'classifica';

export interface SseEvent {
  event: string;
  seq: number;
  data: Record<string, any>;
}

export interface Scenario {
  id: string;
  description: string;
  keywords: string[];
  result: Record<string, any>;
  events: SseEvent[];
}

/** Carica e valida (contro gli schemi) tutti gli scenari in `dir`. */
export function loadScenarios(dir: string, contracts: Contracts): Map<string, Scenario> {
  const validateResult = contracts.validator('api/copilot-result.schema.json');
  const validateEvent = contracts.validator('events/sse-event.schema.json');
  const scenarios = new Map<string, Scenario>();
  for (const name of readdirSync(dir).sort()) {
    const file = join(dir, name, 'scenario.json');
    if (!existsSync(file)) continue;
    const meta = JSON.parse(readFileSync(file, 'utf8'));
    const events: SseEvent[] = readFileSync(join(dir, name, 'events.jsonl'), 'utf8')
      .split('\n')
      .filter((l) => l.trim() !== '')
      .map((l) => JSON.parse(l));
    const errors = [
      ...validateResult(meta.result).map((e) => `result ${e}`),
      ...events.flatMap((ev, i) => validateEvent(ev).map((e) => `events[${i}] ${e}`)),
    ];
    if (meta.id !== name) errors.push(`id "${meta.id}" diverso dal nome cartella "${name}"`);
    if (errors.length) throw new Error(`Scenario "${name}" non valido:\n  ${errors.join('\n  ')}`);
    scenarios.set(meta.id, { id: meta.id, description: meta.description, keywords: meta.keywords ?? [], result: meta.result, events });
  }
  if (!scenarios.has(DEFAULT_SCENARIO_ID)) throw new Error(`Scenario di default "${DEFAULT_SCENARIO_ID}" mancante`);
  return scenarios;
}

/** Header (se presente, deve esistere) -> parola chiave nel messaggio -> default. Restituisce null se l'header e sconosciuto. */
export function pickScenario(scenarios: Map<string, Scenario>, header: string | undefined, message: string): Scenario | null {
  if (header !== undefined) return scenarios.get(header) ?? null;
  const text = message.toLowerCase();
  for (const s of scenarios.values()) {
    if (s.keywords.some((k) => text.includes(k.toLowerCase()))) return s;
  }
  return scenarios.get(DEFAULT_SCENARIO_ID)!;
}
