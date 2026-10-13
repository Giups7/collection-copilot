import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadContracts, type Contracts } from './contracts.ts';
import { conversationIdOf, correlationIdOf, hashOf, requestIdOf } from './ids.ts';
import { problem, type Problem } from './problem.ts';
import { DEFAULT_SCENARIOS_DIR, loadScenarios, pickScenario, type Scenario, type SseEvent } from './scenarios.ts';

const FIXTURES_DIR = resolve(import.meta.dirname, '../fixtures');
const PREFIX = '/v1/copilot';
const MAX_BODY = 64 * 1024;

export interface MockOptions {
  scenariosDir?: string;
  schemasDir?: string;
  /** Ritardo (ms) tra un evento SSE e il successivo. Default 0. Lo scenario puo sovrascriverlo (streaming.delayMs). */
  eventDelayMs?: number;
  /** Chiude la connessione SSE dopo N eventi (solo al primo collegamento, senza Last-Event-ID). Lo scenario puo sovrascriverlo. */
  dropAfterEvents?: number;
  /** CORS (fuori dal contratto): risponde 204 agli OPTIONS prima del controllo Bearer e aggiunge gli header Access-Control-*. Default false. */
  cors?: boolean;
  /** Valore di Access-Control-Allow-Origin. Default http://localhost:4200. */
  corsOrigin?: string;
}

export const DEFAULT_CORS_ORIGIN = 'http://localhost:4200';
const CORS_ALLOW_HEADERS = 'Authorization, Content-Type, Idempotency-Key, X-Correlation-Id, X-Mock-Scenario, Last-Event-ID';

interface RequestRecord {
  requestId: string;
  conversationId: string;
  correlationId: string;
  message: string;
  scenario: Scenario;
}

class HttpError extends Error {
  readonly problem: Problem;
  constructor(p: Problem) {
    super(p.title);
    this.problem = p;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text), ...headers });
  res.end(text);
}

function sendProblem(res: ServerResponse, p: Problem, instance?: string): void {
  const body = instance ? { ...p, instance } : p;
  const text = JSON.stringify(body);
  res.writeHead(p.status, { 'Content-Type': 'application/problem+json', 'Content-Length': Buffer.byteLength(text) });
  res.end(text);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(problem(413, 'payload-too-large', 'Corpo troppo grande'));
    chunks.push(chunk as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(problem(400, 'invalid-json', 'JSON non valido', 'Il corpo della richiesta non e JSON valido.'));
  }
}

const header = (req: IncomingMessage, name: string): string | undefined => {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
};

/** Crea il server mock (non in ascolto). Stessa richiesta => stessa risposta: nessun random, nessun orologio. */
export function createMockServer(options: MockOptions = {}): Server {
  const contracts: Contracts = loadContracts(options.schemasDir);
  const scenarios = loadScenarios(options.scenariosDir ?? DEFAULT_SCENARIOS_DIR, contracts);
  const delayMs = options.eventDelayMs ?? 0;
  const capabilities = JSON.parse(readFileSync(resolve(FIXTURES_DIR, 'capabilities.json'), 'utf8'));
  // Data source e file appartengono agli scenari (ids univoci, verificati al caricamento).
  const dataSources = new Map([...scenarios.values()].flatMap((s) => [...s.dataSources]));
  const files = new Map([...scenarios.values()].flatMap((s) => [...s.files]));
  const corsOrigin = options.corsOrigin ?? DEFAULT_CORS_ORIGIN;
  const validateRequest = contracts.validator('api/copilot-request.schema.json');
  const validateFeedback = contracts.validator('api/feedback.schema.json');

  const requests = new Map<string, RequestRecord>();
  const conversations = new Map<string, string[]>(); // conversationId -> requestId

  const resultOf = (r: RequestRecord) => {
    const result = structuredClone(r.scenario.result);
    result.requestId = r.requestId;
    result.conversationId = r.conversationId;
    result.meta.correlationId = r.correlationId;
    if (result.error?.correlationId) result.error.correlationId = r.correlationId;
    return result;
  };

  const eventsOf = (r: RequestRecord): SseEvent[] =>
    r.scenario.events.map((ev) => {
      const e = structuredClone(ev);
      if (e.event === 'done') {
        e.data.requestId = r.requestId;
        e.data.correlationId = r.correlationId;
      } else if (e.event === 'error' && e.data.correlationId) {
        e.data.correlationId = r.correlationId;
      }
      return e;
    });

  const known = (id: string): RequestRecord => {
    const r = requests.get(id);
    if (!r) throw new HttpError(problem(404, 'request-not-found', 'Richiesta non trovata', `Nessuna richiesta con id ${id}.`));
    return r;
  };

  async function createRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = (await readJson(req)) as { message?: string; conversationId?: string };
    const errors = validateRequest(body);
    if (errors.length) throw new HttpError(problem(400, 'invalid-request', 'Richiesta non valida', errors.join('; ')));
    const scenario = pickScenario(scenarios, header(req, 'x-mock-scenario'), body.message!);
    if (!scenario) {
      throw new HttpError(
        problem(400, 'unknown-scenario', 'Scenario sconosciuto', `X-Mock-Scenario non valido. Scenari disponibili: ${[...scenarios.keys()].join(', ')}.`),
      );
    }
    const idemKey = header(req, 'idempotency-key') ?? '';
    const hash = hashOf(body.message!, scenario.id, idemKey, body.conversationId ?? '');
    const record: RequestRecord = {
      requestId: requestIdOf(hash),
      conversationId: body.conversationId ?? conversationIdOf(hash),
      correlationId: header(req, 'x-correlation-id') ?? correlationIdOf(hash),
      message: body.message!,
      scenario,
    };
    requests.set(record.requestId, record);
    const turns = conversations.get(record.conversationId) ?? [];
    if (!turns.includes(record.requestId)) turns.push(record.requestId);
    conversations.set(record.conversationId, turns);
    send(
      res,
      202,
      {
        requestId: record.requestId,
        conversationId: record.conversationId,
        status: 'QUEUED',
        eventsUrl: `${PREFIX}/requests/${record.requestId}/events`,
        resultUrl: `${PREFIX}/requests/${record.requestId}`,
      },
      { 'X-Correlation-Id': record.correlationId },
    );
  }

  async function streamEvents(req: IncomingMessage, res: ServerResponse, record: RequestRecord): Promise<void> {
    const raw = header(req, 'last-event-id');
    const last = raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : -1;
    const pending = eventsOf(record).filter((e) => e.seq > last);
    const delay = record.scenario.streaming.delayMs ?? delayMs;
    // Interruzione simulata solo al primo collegamento: la ripresa con Last-Event-ID completa lo stream.
    const dropAfter = last === -1 ? (record.scenario.streaming.dropAfterEvents ?? options.dropAfterEvents) : undefined;
    let closed = false;
    res.on('close', () => (closed = true));
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Correlation-Id': record.correlationId,
    });
    for (const [i, e] of pending.entries()) {
      if (closed) return;
      if (dropAfter !== undefined && i >= dropAfter) {
        res.flushHeaders();
        await new Promise<void>((r) => res.write('', () => r())); // lascia partire gli eventi gia scritti, poi cade la connessione
        return void res.destroy();
      }
      if (i > 0 && delay > 0) await sleep(delay);
      if (closed) return;
      res.write(`id: ${e.seq}\nevent: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`);
    }
    res.end();
  }

  function dataPage(url: URL, dataSourceId: string) {
    const rows = dataSources.get(dataSourceId);
    if (!rows) throw new HttpError(problem(404, 'data-source-not-found', 'Sorgente dati non trovata', `Nessuna sorgente ${dataSourceId}.`));
    const intParam = (name: string, def: number, min: number, max: number): number => {
      const v = url.searchParams.get(name);
      if (v === null) return def;
      const n = Number(v);
      if (!/^\d+$/.test(v) || n < min || n > max) {
        throw new HttpError(problem(400, 'invalid-parameter', 'Parametro non valido', `${name} deve essere un intero tra ${min} e ${max}.`));
      }
      return n;
    };
    const page = intParam('page', 0, 0, Number.MAX_SAFE_INTEGER);
    const size = intParam('size', 50, 1, 200);
    let sorted = rows;
    const sort = url.searchParams.get('sort');
    if (sort) {
      const desc = sort.startsWith('-');
      const col = desc ? sort.slice(1) : sort;
      if (!rows.some((r) => col in r)) {
        throw new HttpError(problem(400, 'invalid-parameter', 'Parametro non valido', `Colonna di ordinamento sconosciuta: ${col}.`));
      }
      const cmp = (a: unknown, b: unknown) => (a! < b! ? -1 : a! > b! ? 1 : 0);
      sorted = [...rows].sort((a, b) => (desc ? -1 : 1) * cmp(a[col], b[col]));
    }
    return { dataSourceId, page, size, totalRows: rows.length, rows: sorted.slice(page * size, (page + 1) * size) };
  }

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    const method = req.method ?? 'GET';

    if (!path.startsWith(PREFIX + '/')) {
      throw new HttpError(problem(404, 'not-found', 'Risorsa non trovata', `Percorso sconosciuto: ${path}`));
    }
    if (!/^Bearer\s+\S+/i.test(header(req, 'authorization') ?? '')) {
      throw new HttpError(problem(401, 'unauthorized', 'Non autenticato', 'Header Authorization Bearer mancante.'));
    }
    const seg = path.slice(PREFIX.length + 1).split('/').map(decodeURIComponent);
    const [a, b, c] = seg;
    const methodNotAllowed = () => new HttpError(problem(405, 'method-not-allowed', 'Metodo non consentito', `${method} ${path}`));

    if (seg.length === 1 && a === 'capabilities') {
      if (method !== 'GET') throw methodNotAllowed();
      return send(res, 200, capabilities);
    }
    if (a === 'requests') {
      if (seg.length === 1) {
        if (method !== 'POST') throw methodNotAllowed();
        return createRequest(req, res);
      }
      const record = known(b!);
      if (seg.length === 2) {
        if (method !== 'GET') throw methodNotAllowed();
        return send(res, 200, resultOf(record));
      }
      if (seg.length === 3 && c === 'events') {
        if (method !== 'GET') throw methodNotAllowed();
        return streamEvents(req, res, record);
      }
      if (seg.length === 3 && c === 'cancel') {
        if (method !== 'POST') throw methodNotAllowed();
        res.writeHead(204).end(); // il mock conclude subito: annullare e un no-op
        return;
      }
      if (seg.length === 3 && c === 'feedback') {
        if (method !== 'POST') throw methodNotAllowed();
        const errors = validateFeedback(await readJson(req));
        if (errors.length) throw new HttpError(problem(400, 'invalid-request', 'Feedback non valido', errors.join('; ')));
        res.writeHead(204).end();
        return;
      }
    }
    if (a === 'conversations' && seg.length === 2) {
      if (method !== 'GET') throw methodNotAllowed();
      const ids = conversations.get(b!);
      if (!ids) throw new HttpError(problem(404, 'conversation-not-found', 'Conversazione non trovata', `Nessuna conversazione ${b}.`));
      const records = ids.map((id) => requests.get(id)!);
      return send(res, 200, {
        conversationId: b,
        createdAt: records[0]!.scenario.result.meta.createdAt,
        turns: records.map((r) => ({ requestId: r.requestId, message: r.message, result: resultOf(r) })),
      });
    }
    if (a === 'data' && seg.length === 2) {
      if (method !== 'GET') throw methodNotAllowed();
      return send(res, 200, dataPage(url, b!));
    }
    if (a === 'files' && seg.length === 2) {
      if (method !== 'GET') throw methodNotAllowed();
      const file = files.get(b!);
      if (!file) throw new HttpError(problem(404, 'file-not-found', 'File non trovato', `Nessun file ${b}.`));
      res.writeHead(200, {
        'Content-Type': file.contentType,
        'Content-Length': file.body.length,
        'Content-Disposition': `attachment; filename="${file.filename}"`,
      });
      res.end(file.body);
      return;
    }
    throw new HttpError(problem(404, 'not-found', 'Risorsa non trovata', `Percorso sconosciuto: ${path}`));
  }

  return createServer((req, res) => {
    if (options.cors) {
      res.setHeader('Access-Control-Allow-Origin', corsOrigin);
      res.setHeader('Access-Control-Expose-Headers', 'X-Correlation-Id');
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Headers', CORS_ALLOW_HEADERS);
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Max-Age', '600');
        res.writeHead(204).end(); // preflight: prima del controllo Bearer
        return;
      }
    }
    route(req, res).catch((err) => {
      const p = err instanceof HttpError ? err.problem : problem(500, 'internal-error', 'Errore interno', String(err?.message ?? err));
      if (res.headersSent) return void res.end();
      sendProblem(res, p, req.url?.split('?')[0]);
    });
  });
}
