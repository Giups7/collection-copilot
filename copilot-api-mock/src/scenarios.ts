import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import type { Contracts } from './contracts.ts';
import { buildFile, type MockFile } from './files.ts';

export const DEFAULT_SCENARIOS_DIR = resolve(import.meta.dirname, '../scenarios');
export const DEFAULT_SCENARIO_ID = 'classifica';

export interface SseEvent {
  event: string;
  seq: number;
  data: Record<string, any>;
}

/** Comportamento dello stream specifico dello scenario (fuori dal contratto, solo per il mock). */
export interface StreamingOptions {
  /** Ritardo (ms) tra gli eventi: sovrascrive quello globale. */
  delayMs?: number;
  /** Chiude la connessione dopo N eventi inviati (solo al primo collegamento, senza Last-Event-ID). */
  dropAfterEvents?: number;
}

export interface Scenario {
  id: string;
  description: string;
  keywords: string[];
  streaming: StreamingOptions;
  result: Record<string, any>;
  events: SseEvent[];
  /** Sorgenti dati dei blocchi table: `scenarios/<id>/data/<dataSourceId>.json` (`{ "rows": [...] }`). */
  dataSources: Map<string, Record<string, unknown>[]>;
  /** File dei blocchi file, dichiarati in `scenario.json` (`files`). */
  files: Map<string, MockFile>;
}

const isNonNegInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

function loadStreaming(raw: any, errors: string[]): StreamingOptions {
  const out: StreamingOptions = {};
  if (raw === undefined) return out;
  if (raw.delayMs !== undefined) isNonNegInt(raw.delayMs) ? (out.delayMs = raw.delayMs) : errors.push('streaming.delayMs deve essere un intero >= 0');
  if (raw.dropAfterEvents !== undefined) {
    isNonNegInt(raw.dropAfterEvents) ? (out.dropAfterEvents = raw.dropAfterEvents) : errors.push('streaming.dropAfterEvents deve essere un intero >= 0');
  }
  return out;
}

/** Controlli di coerenza tra risultato, eventi, sorgenti dati e file dello scenario. */
function crossCheck(s: Scenario, errors: string[]): void {
  const blocks: any[] = s.result.blocks ?? [];
  for (const b of blocks) {
    if (b.type === 'table') {
      const rows = s.dataSources.get(b.dataSourceId);
      if (!rows) errors.push(`blocco ${b.id}: dataSourceId "${b.dataSourceId}" senza data/${b.dataSourceId}.json`);
      else {
        if (rows.length !== b.totalRows) errors.push(`blocco ${b.id}: totalRows ${b.totalRows} ma le righe sono ${rows.length}`);
        for (const col of b.columns) {
          if (rows.some((r) => !(col.key in r))) errors.push(`blocco ${b.id}: colonna "${col.key}" assente in alcune righe`);
        }
      }
    }
    if (b.type === 'file') {
      const f = s.files.get(b.fileId);
      if (!f) errors.push(`blocco ${b.id}: fileId "${b.fileId}" non dichiarato in files`);
      else {
        if (f.filename !== b.name) errors.push(`blocco ${b.id}: name diverso dal file dichiarato`);
        if (b.sizeBytes !== undefined && b.sizeBytes !== f.body.length) errors.push(`blocco ${b.id}: sizeBytes ${b.sizeBytes} ma il file pesa ${f.body.length}`);
      }
    }
  }
  const evBlocks = s.events.filter((e) => e.event === 'block').map((e) => e.data);
  if (JSON.stringify(evBlocks) !== JSON.stringify(blocks)) errors.push('i blocchi degli eventi non coincidono con result.blocks');
  const text = s.events.filter((e) => e.event === 'message.delta').map((e) => e.data.text).join('');
  if (s.result.status === 'COMPLETED' && text !== s.result.message) errors.push('i message.delta concatenati non coincidono con result.message');
  s.events.forEach((e, i) => e.seq !== i && errors.push(`events[${i}] seq ${e.seq} non progressivo`));
  const done = s.events.at(-1);
  if (done?.event !== 'done' || done.data.status !== s.result.status) errors.push('l\'ultimo evento deve essere done con lo stesso status del risultato');
  const err = s.events.find((e) => e.event === 'error');
  if (s.result.status === 'FAILED' && (!err || err.data.status !== s.result.error?.status || err.data.retryable !== s.result.error?.retryable)) {
    errors.push('scenario FAILED: evento error e result.error devono coincidere (status, retryable)');
  }
}

/** Carica e valida (contro gli schemi) tutti gli scenari in `dir`. */
export function loadScenarios(dir: string, contracts: Contracts): Map<string, Scenario> {
  const validateResult = contracts.validator('api/copilot-result.schema.json');
  const validateEvent = contracts.validator('events/sse-event.schema.json');
  const scenarios = new Map<string, Scenario>();
  const owner = new Map<string, string>(); // "data:<id>" | "file:<id>" -> scenario
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

    const dataSources = new Map<string, Record<string, unknown>[]>();
    const dataDir = join(dir, name, 'data');
    if (existsSync(dataDir)) {
      for (const f of readdirSync(dataDir).filter((f) => f.endsWith('.json'))) {
        dataSources.set(basename(f, '.json'), JSON.parse(readFileSync(join(dataDir, f), 'utf8')).rows);
      }
    }
    const files = new Map<string, MockFile>();
    for (const f of meta.files ?? []) files.set(f.fileId, buildFile(f.format, f.name));

    const scenario: Scenario = {
      id: meta.id,
      description: meta.description,
      keywords: meta.keywords ?? [],
      streaming: loadStreaming(meta.streaming, errors),
      result: meta.result,
      events,
      dataSources,
      files,
    };
    crossCheck(scenario, errors);
    for (const key of [...dataSources.keys()].map((k) => `data:${k}`).concat([...files.keys()].map((k) => `file:${k}`))) {
      const other = owner.get(key);
      if (other) errors.push(`${key} gia definito dallo scenario "${other}"`);
      owner.set(key, name);
    }
    if (errors.length) throw new Error(`Scenario "${name}" non valido:\n  ${errors.join('\n  ')}`);
    scenarios.set(meta.id, scenario);
  }
  if (!scenarios.has(DEFAULT_SCENARIO_ID)) throw new Error(`Scenario di default "${DEFAULT_SCENARIO_ID}" mancante`);
  return scenarios;
}

/**
 * Header (se presente, deve esistere) -> parola chiave nel messaggio -> default.
 * Se piu scenari corrispondono vince la parola chiave piu lunga (la piu specifica).
 * Restituisce null se l'header e sconosciuto.
 */
export function pickScenario(scenarios: Map<string, Scenario>, header: string | undefined, message: string): Scenario | null {
  if (header !== undefined) return scenarios.get(header) ?? null;
  const text = message.toLowerCase();
  let best: Scenario | undefined;
  let bestLen = 0;
  for (const s of scenarios.values()) {
    for (const k of s.keywords) {
      if (k.length > bestLen && text.includes(k.toLowerCase())) {
        best = s;
        bestLen = k.length;
      }
    }
  }
  return best ?? scenarios.get(DEFAULT_SCENARIO_ID)!;
}
