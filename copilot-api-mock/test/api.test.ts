import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { loadContracts } from '../src/contracts.ts';
import { createMockServer } from '../src/app.ts';

const contracts = loadContracts();
const check = (ref: string, doc: unknown) => {
  expect(contracts.validator(ref)(doc), JSON.stringify(doc).slice(0, 300)).toEqual([]);
};

let server: Server;
let base: string;

beforeAll(async () => {
  server = createMockServer({ eventDelayMs: 0 });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const auth = { Authorization: 'Bearer qualunque-token' };
const api = (path: string, init: RequestInit & { headers?: Record<string, string> } = {}) =>
  fetch(base + path, { ...init, headers: { ...auth, ...init.headers } });
const post = (message: string, headers: Record<string, string> = {}, extra: object = {}) =>
  api('/v1/copilot/requests', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ message, ...extra }),
  });

async function expectProblem(res: Response, status: number) {
  expect(res.status).toBe(status);
  expect(res.headers.get('content-type')).toContain('application/problem+json');
  const body = await res.json();
  check('common/problem.schema.json', body);
  expect(body.status).toBe(status);
}

function parseSse(text: string) {
  return text
    .split('\n\n')
    .filter((b) => b.trim())
    .map((block) => {
      const f: Record<string, string> = {};
      for (const line of block.split('\n')) {
        const i = line.indexOf(': ');
        f[line.slice(0, i)] = line.slice(i + 2);
      }
      return { event: f.event!, seq: Number(f.id), data: JSON.parse(f.data!) };
    });
}

describe('POST /v1/copilot/requests', () => {
  it('risponde 202 con X-Correlation-Id e corpo conforme', async () => {
    const res = await post('Chi va meglio sulle 1P?', { 'Idempotency-Key': 'k1', 'X-Correlation-Id': 'corr-1' });
    expect(res.status).toBe(202);
    expect(res.headers.get('x-correlation-id')).toBe('corr-1');
    const body = await res.json();
    check('api/request-accepted.schema.json', body);
    expect(body.eventsUrl).toBe(`/v1/copilot/requests/${body.requestId}/events`);
    expect(body.resultUrl).toBe(`/v1/copilot/requests/${body.requestId}`);
  });

  it('genera X-Correlation-Id se assente', async () => {
    const res = await post('Chi va meglio?');
    expect(res.headers.get('x-correlation-id')).toBeTruthy();
  });

  it('e deterministica: stessi input, stessi id; input diversi, id diversi', async () => {
    const a = await (await post('Classifica 1P', { 'Idempotency-Key': 'k' })).json();
    const b = await (await post('Classifica 1P', { 'Idempotency-Key': 'k' })).json();
    const c = await (await post('Classifica 1P', { 'Idempotency-Key': 'altra' })).json();
    expect(b).toEqual(a);
    expect(c.requestId).not.toBe(a.requestId);
  });

  it('401 senza Bearer, 400 con corpo non valido o JSON rotto', async () => {
    await expectProblem(await fetch(`${base}/v1/copilot/requests`, { method: 'POST', body: '{}' }), 401);
    await expectProblem(await fetch(`${base}/v1/copilot/capabilities`, { headers: { Authorization: 'Basic x' } }), 401);
    await expectProblem(await post(''), 400);
    await expectProblem(await post('ciao', {}, { campoInventato: 1 }), 400);
    await expectProblem(
      await api('/v1/copilot/requests', { method: 'POST', body: '{rotto' }),
      400,
    );
  });
});

describe('scelta dello scenario', () => {
  const resultOf = async (message: string, headers: Record<string, string> = {}) => {
    const acc = await (await post(message, headers)).json();
    return (await api(acc.resultUrl)).json();
  };

  it('default quando nessuna parola chiave corrisponde', async () => {
    expect((await resultOf('buongiorno')).status).toBe('COMPLETED');
  });
  it('per parola chiave (case-insensitive)', async () => {
    expect((await resultOf('Mostrami un ERRORE')).status).toBe('FAILED');
  });
  it('l\'header ha la precedenza sulle parole chiave', async () => {
    expect((await resultOf('Mostrami un errore', { 'X-Mock-Scenario': 'classifica' })).status).toBe('COMPLETED');
    expect((await resultOf('Classifica 1P', { 'X-Mock-Scenario': 'errore' })).status).toBe('FAILED');
  });
  it('header sconosciuto -> 400 problem+json', async () => {
    await expectProblem(await post('ciao', { 'X-Mock-Scenario': 'non-esiste' }), 400);
  });
});

describe('GET risultato, SSE, cancel, feedback, conversazione', () => {
  it('risultato completo conforme, con id della richiesta', async () => {
    const acc = await (await post('Classifica 1P', { 'Idempotency-Key': 'r1' })).json();
    const res = await api(acc.resultUrl);
    expect(res.status).toBe(200);
    const body = await res.json();
    check('api/copilot-result.schema.json', body);
    expect(body.requestId).toBe(acc.requestId);
    expect(body.conversationId).toBe(acc.conversationId);
    expect(body.meta.createdAt).toBe('2026-10-13T09:15:02Z');
    expect(await (await api(acc.resultUrl)).json()).toEqual(body);
  });

  it('scenario errore: risultato FAILED conforme', async () => {
    const acc = await (await post('x', { 'X-Mock-Scenario': 'errore' })).json();
    const body = await (await api(acc.resultUrl)).json();
    check('api/copilot-result.schema.json', body);
    expect(body.status).toBe('FAILED');
    expect(body.error.status).toBe(403);
  });

  it('SSE: ogni evento e conforme, termina con done e usa gli id della richiesta', async () => {
    const acc = await (await post('Classifica 1P', { 'X-Correlation-Id': 'c-sse' })).json();
    const res = await api(acc.eventsUrl);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const events = parseSse(await res.text());
    expect(events.length).toBeGreaterThan(3);
    events.forEach((e) => check('events/sse-event.schema.json', e));
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i));
    const last = events.at(-1)!;
    expect(last.event).toBe('done');
    expect(last.data).toMatchObject({ requestId: acc.requestId, correlationId: 'c-sse', status: 'COMPLETED' });
  });

  it('SSE: Last-Event-ID riprende dall\'evento successivo', async () => {
    const acc = await (await post('Classifica 1P')).json();
    const all = parseSse(await (await api(acc.eventsUrl)).text());
    const resumed = parseSse(await (await api(acc.eventsUrl, { headers: { 'Last-Event-ID': '3' } })).text());
    expect(resumed.map((e) => e.seq)).toEqual(all.filter((e) => e.seq > 3).map((e) => e.seq));
    resumed.forEach((e) => check('events/sse-event.schema.json', e));
  });

  it('SSE: scenario errore termina con error e done FAILED', async () => {
    const acc = await (await post('x', { 'X-Mock-Scenario': 'errore' })).json();
    const events = parseSse(await (await api(acc.eventsUrl)).text());
    events.forEach((e) => check('events/sse-event.schema.json', e));
    expect(events.map((e) => e.event)).toEqual(['status', 'error', 'done']);
    expect(events[2]!.data.status).toBe('FAILED');
  });

  it('SSE e risultato per richieste uguali sono identici', async () => {
    const one = await (await post('Classifica 1P', { 'Idempotency-Key': 'same' })).json();
    const two = await (await post('Classifica 1P', { 'Idempotency-Key': 'same' })).json();
    expect(await (await api(two.eventsUrl)).text()).toBe(await (await api(one.eventsUrl)).text());
  });

  it('404 su richiesta sconosciuta (result, events, cancel, feedback)', async () => {
    await expectProblem(await api('/v1/copilot/requests/r-nope'), 404);
    await expectProblem(await api('/v1/copilot/requests/r-nope/events'), 404);
    await expectProblem(await api('/v1/copilot/requests/r-nope/cancel', { method: 'POST' }), 404);
    await expectProblem(
      await api('/v1/copilot/requests/r-nope/feedback', { method: 'POST', body: '{"rating":"USEFUL"}' }),
      404,
    );
  });

  it('cancel -> 204', async () => {
    const acc = await (await post('Classifica 1P')).json();
    expect((await api(`${acc.resultUrl}/cancel`, { method: 'POST' })).status).toBe(204);
  });

  it('feedback: 204 se valido, 400 altrimenti', async () => {
    const acc = await (await post('Classifica 1P')).json();
    const fb = (body: unknown) => api(`${acc.resultUrl}/feedback`, { method: 'POST', body: JSON.stringify(body) });
    expect((await fb({ rating: 'NOT_USEFUL', reasons: ['UNCLEAR'], comment: 'ok' })).status).toBe(204);
    await expectProblem(await fb({ rating: 'MAH' }), 400);
  });

  it('conversazione: storico dei turni, conforme', async () => {
    const first = await (await post('Classifica 1P', { 'Idempotency-Key': 'conv-1' })).json();
    await post('Mostrami un errore', {}, { conversationId: first.conversationId });
    const res = await api(`/v1/copilot/conversations/${first.conversationId}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    check('api/conversation.schema.json', body);
    expect(body.turns).toHaveLength(2);
    expect(body.turns[0].requestId).toBe(first.requestId);
    await expectProblem(await api('/v1/copilot/conversations/c-nope'), 404);
  });
});

describe('dati, file, capabilities', () => {
  it('data: paginazione, ordinamento e default', async () => {
    const res = await api('/v1/copilot/data/ds-perf-1p?page=0&size=2');
    expect(res.status).toBe(200);
    const p0 = await res.json();
    check('api/data-page.schema.json', p0);
    expect(p0).toMatchObject({ page: 0, size: 2, totalRows: 3 });
    expect(p0.rows).toHaveLength(2);
    const p1 = await (await api('/v1/copilot/data/ds-perf-1p?page=1&size=2')).json();
    check('api/data-page.schema.json', p1);
    expect(p1.rows).toHaveLength(1);
    const desc = await (await api('/v1/copilot/data/ds-perf-1p?sort=-index')).json();
    check('api/data-page.schema.json', desc);
    expect(desc.size).toBe(50);
    expect(desc.rows.map((r: any) => r.collector)).toEqual(['FIDES', 'PHONICA', 'TELECOM']);
    const asc = await (await api('/v1/copilot/data/ds-perf-1p?sort=index')).json();
    expect(asc.rows[0].collector).toBe('TELECOM');
  });

  it('data: size massimo 200, parametri non validi -> 400, sorgente ignota -> 404', async () => {
    check('api/data-page.schema.json', await (await api('/v1/copilot/data/ds-perf-1p?size=200')).json());
    await expectProblem(await api('/v1/copilot/data/ds-perf-1p?size=201'), 400);
    await expectProblem(await api('/v1/copilot/data/ds-perf-1p?size=0'), 400);
    await expectProblem(await api('/v1/copilot/data/ds-perf-1p?page=-1'), 400);
    await expectProblem(await api('/v1/copilot/data/ds-perf-1p?sort=colonnaInesistente'), 400);
    await expectProblem(await api('/v1/copilot/data/ds-nope'), 404);
  });

  it('files: pdf e xlsx, 404 se ignoto', async () => {
    const pdf = await api('/v1/copilot/files/f-20261013-001');
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get('content-type')).toBe('application/pdf');
    expect((await pdf.text()).startsWith('%PDF-')).toBe(true);
    const xlsx = await api('/v1/copilot/files/f-20261013-002');
    expect(xlsx.headers.get('content-type')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const bytes = Buffer.from(await xlsx.arrayBuffer());
    expect(bytes.subarray(0, 4).toString('hex')).toBe('504b0304');
    await expectProblem(await api('/v1/copilot/files/f-nope'), 404);
  });

  it('capabilities conformi; 401 senza token', async () => {
    const res = await api('/v1/copilot/capabilities');
    expect(res.status).toBe(200);
    check('api/capabilities.schema.json', await res.json());
    await expectProblem(await fetch(`${base}/v1/copilot/capabilities`), 401);
  });

  it('percorsi sconosciuti -> 404 problem+json', async () => {
    await expectProblem(await api('/v1/copilot/nulla'), 404);
    await expectProblem(await fetch(`${base}/altro`), 404);
  });
});

describe('scenari', () => {
  it('ritardo parametrico tra eventi', async () => {
    const slow = createMockServer({ eventDelayMs: 40 });
    await new Promise<void>((r) => slow.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${(slow.address() as AddressInfo).port}`;
    const h = { ...auth, 'Content-Type': 'application/json' };
    const acc = await (await fetch(`${url}/v1/copilot/requests`, { method: 'POST', headers: h, body: '{"message":"x"}' })).json();
    const t0 = performance.now();
    await (await fetch(url + acc.eventsUrl, { headers: auth })).text();
    expect(performance.now() - t0).toBeGreaterThanOrEqual(40 * 6);
    await new Promise<void>((r) => slow.close(() => r()));
  });
});
