import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createMockServer } from '../src/app.ts';
import { DEFAULT_SCENARIOS_DIR, loadScenarios } from '../src/scenarios.ts';
import { check, contracts, parseSse, scenariosCopy, startMock, type Mock } from './helpers.ts';

const scenarios = loadScenarios(DEFAULT_SCENARIOS_DIR, contracts);
const capabilities = JSON.parse(readFileSync(new URL('../fixtures/capabilities.json', import.meta.url), 'utf8'));

let mock: Mock;
beforeAll(async () => (mock = await startMock()));
afterAll(() => mock.close());

const run = async (id: string) => {
  const acc = await (await mock.post('x', { 'X-Mock-Scenario': id })).json();
  const result = await (await mock.api(acc.resultUrl)).json();
  const events = parseSse(await (await mock.api(acc.eventsUrl)).text());
  return { acc, result, events };
};

/** Identifica lo scenario dal contenuto del risultato (messaggio o titolo dell'errore). */
const fingerprint = (result: any) => result.message ?? result.error?.title;

describe('catalogo scenari', () => {
  it('almeno 10 scenari, ciascuno con eventi SSE e risposta completa', () => {
    expect(scenarios.size).toBeGreaterThanOrEqual(10);
    for (const s of scenarios.values()) {
      expect(s.description, s.id).toBeTruthy();
      expect(s.events.length, s.id).toBeGreaterThan(2);
      expect(s.result.meta.createdAt, s.id).toBeTruthy();
    }
  });

  it.each([...scenarios.keys()])('%s: risultato ed eventi conformi e coerenti tra loro', async (id) => {
    const { acc, result, events } = await run(id);
    check('api/copilot-result.schema.json', result);
    events.forEach((e) => check('events/sse-event.schema.json', e));
    expect(result.requestId).toBe(acc.requestId);
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i));
    const done = events.at(-1)!;
    expect(done.event).toBe('done');
    expect(done.data.status).toBe(result.status);
    expect(done.data.requestId).toBe(acc.requestId);
    expect(events.filter((e) => e.event === 'block').map((e) => e.data)).toEqual(result.blocks ?? []);
    if (result.status === 'COMPLETED') {
      expect(events.filter((e) => e.event === 'message.delta').map((e) => e.data.text).join('')).toBe(result.message);
    }
  });

  it('ogni tipo di blocco delle capabilities compare in almeno uno scenario', () => {
    const used = new Set([...scenarios.values()].flatMap((s) => (s.result.blocks ?? []).map((b: any) => b.type)));
    for (const type of capabilities.blockTypes) expect(used.has(type), type).toBe(true);
    expect([...used].sort()).toEqual([...capabilities.blockTypes].sort());
  });

  it('parole chiave distinte tra scenari, e ognuna instrada al proprio scenario', async () => {
    const owner = new Map<string, string>();
    for (const s of scenarios.values()) {
      for (const k of s.keywords.map((k) => k.toLowerCase())) {
        expect(owner.get(k), `parola chiave "${k}" duplicata`).toBeUndefined();
        owner.set(k, s.id);
      }
    }
    for (const [keyword, id] of owner) {
      const acc = await (await mock.post(`Per favore: ${keyword.toUpperCase()}!`)).json();
      const result = await (await mock.api(acc.resultUrl)).json();
      expect(fingerprint(result), keyword).toBe(fingerprint(scenarios.get(id)!.result));
    }
  });

  it('i prompt suggeriti delle capabilities arrivano a scenari pertinenti', async () => {
    const expected: Record<string, string> = {
      'Andamento portafoglio': 'riepilogo',
      'Migliori per fascia': 'classifica',
      Strategie: 'insight',
      Previsione: 'previsione',
      Anomalie: 'insight',
    };
    for (const p of capabilities.suggestedPrompts) {
      const acc = await (await mock.post(p.message)).json();
      const got = await (await mock.api(acc.resultUrl)).json();
      expect(fingerprint(got), p.label).toBe(fingerprint(scenarios.get(expected[p.label]!)!.result));
    }
  });
});

describe('frasi miste', () => {
  it('parole generiche come "performance" non rubano lo scenario specifico', async () => {
    const cases: Record<string, string> = {
      'mostrami la heatmap di performance': 'heatmap',
      'genera il report di performance': 'report',
      'simula la performance se riassegno': 'simulazione',
      'chi performa meglio in 1P?': 'classifica',
    };
    for (const [message, id] of Object.entries(cases)) {
      const acc = await (await mock.post(message)).json();
      const got = await (await mock.api(acc.resultUrl)).json();
      expect(fingerprint(got), message).toBe(fingerprint(scenarios.get(id)!.result));
    }
  });
});

describe('errori', () => {
  it('403: evento SSE error non ritentabile, risultato FAILED, nessun blocco', async () => {
    const { acc, result, events } = await run('errore');
    expect(acc.status).toBe('QUEUED');
    expect(result).toMatchObject({ status: 'FAILED', error: { status: 403, retryable: false } });
    expect(result.blocks).toBeUndefined();
    expect(events.find((e) => e.event === 'error')!.data).toMatchObject({ status: 403, retryable: false });
    expect(events.at(-1)!.data.status).toBe('FAILED');
  });

  it('errore temporaneo: 503 con retryable=true in evento SSE e risultato', async () => {
    const { result, events } = await run('errore-temporaneo');
    expect(result).toMatchObject({ status: 'FAILED', error: { status: 503, retryable: true } });
    expect(events.find((e) => e.event === 'error')!.data).toMatchObject({ status: 503, retryable: true });
    expect(events.at(-1)!.data.status).toBe('FAILED');
  });
});

describe('risorse per scenario (data source e file)', () => {
  it('ogni blocco table e pageabile e ogni blocco file e scaricabile', async () => {
    let tables = 0;
    let filesCount = 0;
    for (const s of scenarios.values()) {
      for (const b of s.result.blocks ?? []) {
        if (b.type === 'table') {
          tables++;
          const page = await (await mock.api(`/v1/copilot/data/${b.dataSourceId}?size=200`)).json();
          check('api/data-page.schema.json', page);
          expect(page.totalRows, b.dataSourceId).toBe(b.totalRows);
          expect(page.rows).toHaveLength(b.totalRows);
          for (const col of b.columns) expect(page.rows.every((r: any) => col.key in r), `${b.dataSourceId}.${col.key}`).toBe(true);
        }
        if (b.type === 'file') {
          filesCount++;
          const res = await mock.api(`/v1/copilot/files/${b.fileId}`);
          expect(res.status, b.fileId).toBe(200);
          expect(res.headers.get('content-disposition')).toContain(b.name);
          expect((await res.arrayBuffer()).byteLength).toBe(b.sizeBytes);
        }
      }
    }
    expect(tables).toBeGreaterThanOrEqual(2);
    expect(filesCount).toBeGreaterThanOrEqual(2);
  });

  it('le risorse appartengono a un solo scenario', () => {
    const seen = new Map<string, string>();
    for (const s of scenarios.values()) {
      for (const key of [...s.dataSources.keys(), ...s.files.keys()]) {
        expect(seen.get(key), `${key} definito due volte`).toBeUndefined();
        seen.set(key, s.id);
      }
    }
  });

  it('caricamento: risorsa duplicata tra scenari, mancante o incoerente -> errore', () => {
    const dup = scenariosCopy();
    mkdirSync(join(dup, 'incassi', 'data'), { recursive: true });
    cpSync(join(dup, 'riepilogo', 'data', 'ds-portafoglio-fasce.json'), join(dup, 'incassi', 'data', 'ds-portafoglio-fasce.json'));
    expect(() => createMockServer({ scenariosDir: dup })).toThrow(/gia definito/);

    const missing = scenariosCopy({ riepilogo: (s) => (s.result.blocks[1].dataSourceId = 'ds-inesistente') });
    expect(() => createMockServer({ scenariosDir: missing })).toThrow(/ds-inesistente/);

    const badFile = scenariosCopy({ report: (s) => (s.result.blocks[0].fileId = 'f-inesistente') });
    expect(() => createMockServer({ scenariosDir: badFile })).toThrow(/f-inesistente/);

    const badSize = scenariosCopy({ report: (s) => (s.result.blocks[0].sizeBytes = 1) });
    expect(() => createMockServer({ scenariosDir: badSize })).toThrow(/sizeBytes/);

    const badRows = scenariosCopy();
    writeFileSync(join(badRows, 'riepilogo', 'data', 'ds-portafoglio-fasce.json'), '{"rows":[{"fascia":"1P"}]}');
    expect(() => createMockServer({ scenariosDir: badRows })).toThrow(/totalRows/);
  });
});
