import { request } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Contracts, DEFAULT_CONTRACTS_DIR } from '../src/contracts.ts';
import { MAX_REQUEST_BODY_BYTES, startServer, type RunningServer } from '../src/server.ts';

const SEED = 20261013;
const TOOLS = [
  'get_kpi_catalog',
  'list_collectors',
  'get_portfolio_summary',
  'get_recovery_trend',
  'get_portfolio_distribution',
  'get_collector_performance',
  'compare_collectors',
  'rank_collectors_by_band',
  'get_case_timeline',
];

const contracts = new Contracts();
let server: RunningServer;
let client: Client;

async function connect(url: string): Promise<Client> {
  const c = new Client({ name: 'test', version: '0.0.0' });
  await c.connect(new StreamableHTTPClientTransport(new URL(url)));
  return c;
}

async function call(c: Client, name: string, args: Record<string, unknown>) {
  const res = await c.callTool({ name, arguments: args });
  return res as { isError?: boolean; content: { type: string; text: string }[]; structuredContent?: Record<string, unknown> };
}

const example = (tool: string): Record<string, unknown> | undefined => {
  const file = join(DEFAULT_CONTRACTS_DIR, 'examples', 'tools', `${tool}.input.json`);
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>) : undefined;
};

beforeAll(async () => {
  server = await startServer({ port: 0, seed: SEED, contracts });
  client = await connect(server.url);
}, 60_000);

afterAll(async () => {
  await client?.close();
  await server?.close();
});

describe('tools/list', () => {
  it('espone i 9 tool con descrizioni e schemi del contratto', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOLS].sort());
    for (const t of tools) {
      expect(t.description).toBe(contracts.definition(t.name).description);
      expect(t.inputSchema).toEqual(contracts.bundled(t.name, 'input'));
      expect(t.outputSchema).toEqual(contracts.bundled(t.name, 'output'));
    }
  });

  it('non espone tool controfattuali (D-42)', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).not.toContain('simulate_reassignment');
  });
});

describe('esempi del contratto', () => {
  for (const tool of TOOLS.filter((t) => t !== 'get_case_timeline')) {
    it(`${tool}: output valido contro $defs/output`, async () => {
      const args = example(tool);
      expect(args).toBeDefined();
      const res = await call(client, tool, args!);
      expect(res.isError).toBeUndefined();
      expect(contracts.validate(tool, 'output', res.structuredContent)).toBeNull();
      expect(JSON.parse(res.content[0]!.text)).toEqual(res.structuredContent);
    });
  }

  it('ogni output con meta riporta tool, asOf, scope e seed del dataset', async () => {
    for (const tool of TOOLS.filter((t) => t !== 'get_kpi_catalog' && t !== 'get_case_timeline')) {
      const res = await call(client, tool, example(tool) ?? {});
      const meta = res.structuredContent!.meta as Record<string, unknown>;
      expect(meta).toMatchObject({ tool, asOf: '2026-09-30', seed: SEED });
      expect(meta.scope).toBeTypeOf('object');
    }
  });
});

describe('indice per mix e classifica (da analytics-engine)', () => {
  it('rank_collectors_by_band: FIDES prima in 1P, sopra le attese, con indice e intervallo', async () => {
    const res = await call(client, 'rank_collectors_by_band', example('rank_collectors_by_band')!);
    const bands = res.structuredContent!.bands as { fascia: string; ranking: { collector: string; index?: number; ci?: number[]; label: string }[] }[];
    const first = bands.find((b) => b.fascia === '1P')!.ranking[0]!;
    expect(first).toMatchObject({ collector: 'FIDES', label: 'ABOVE' });
    expect(first.index).toBeGreaterThan(1);
    expect(first.ci).toHaveLength(2);
  });

  it('compare_collectors: indice e intervalli sui KPI con indice, solo valore sugli altri', async () => {
    const res = await call(client, 'compare_collectors', example('compare_collectors')!);
    const rows = res.structuredContent!.rows as { collector: string; metrics: { kpi: string; index?: number; indexCi?: number[] }[] }[];
    const fides = rows.find((r) => r.collector === 'FIDES')!.metrics;
    expect(fides.find((m) => m.kpi === 'RR_90')!.index).toBeGreaterThan(1);
    expect(fides.find((m) => m.kpi === 'FIRST_PAY_DAYS')!.index).toBeUndefined();
  });
});

describe('get_case_timeline', () => {
  it('pratica del dataset: timeline valida e riferimento pseudonimizzato', async () => {
    const res = await call(client, 'get_case_timeline', { caseRef: 'P000001' });
    expect(res.isError).toBeUndefined();
    expect(contracts.validate('get_case_timeline', 'output', res.structuredContent)).toBeNull();
    const out = res.structuredContent as { caseRef: string; events: { kind: string }[] };
    expect(out.caseRef).toMatch(/^PR-[0-9A-F]{10}$/);
    expect(out.events[0]!.kind).toBe('ASSIGNMENT_START');
  });

  it('esempio del contratto (LE-76168): pratica inesistente nel dataset, errore leggibile', async () => {
    const res = await call(client, 'get_case_timeline', example('get_case_timeline')!);
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toContain('non trovata');
  });
});

describe('validazione e errori', () => {
  it('input non valido: errore MCP leggibile, nessuna esecuzione', async () => {
    const res = await call(client, 'get_portfolio_distribution', { dimension: 'NOPE', extra: 1 });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toMatch(/Input non valido per get_portfolio_distribution/);
    expect(res.content[0]!.text).toContain('/dimension');
    expect(res.content[0]!.text).toContain('"extra"');
  });

  it('campo obbligatorio mancante', async () => {
    const res = await call(client, 'compare_collectors', { fascia: '1P' });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toContain('collectors');
  });

  it('KPI non calcolabile (PTP_KEPT): errore leggibile', async () => {
    const res = await call(client, 'get_collector_performance', { kpi: 'PTP_KEPT' });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toContain('PTP_KEPT');
  });

  it('tool sconosciuto: errore di protocollo', async () => {
    await expect(client.callTool({ name: 'simulate_reassignment', arguments: {} })).rejects.toThrow(/sconosciuto/);
  });

  it('GET /mcp: 405; altri percorsi: 404', async () => {
    expect((await fetch(server.url)).status).toBe(405);
    expect((await fetch(server.url.replace('/mcp', '/altro'), { method: 'POST' })).status).toBe(404);
  });
});

/** POST /mcp con header arbitrari (fetch non permette di falsificare Host). */
function rawPost(url: string, headers: Record<string, string>, body: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = request(
      { host: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers } },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode ?? 0));
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}
const LIST = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });

describe('sicurezza HTTP', () => {
  it('Origin estraneo: 403 (anti DNS rebinding)', async () => {
    expect(await rawPost(server.url, { origin: 'http://evil.example' }, LIST)).toBe(403);
  });

  it('Host estraneo: 403', async () => {
    expect(await rawPost(server.url, { host: 'evil.example' }, LIST)).toBe(403);
  });

  it('senza Origin (client non browser) e con Origin locale: ammesse', async () => {
    expect(await rawPost(server.url, {}, LIST)).toBe(200);
    expect(await rawPost(server.url, { origin: `http://localhost:${server.port}` }, LIST)).toBe(200);
  });

  it('origine aggiuntiva configurata: ammessa', async () => {
    const s = await startServer({ port: 0, seed: SEED, contracts, allowedOrigins: ['http://app.example'] });
    try {
      expect(await rawPost(s.url, { origin: 'http://app.example' }, LIST)).toBe(200);
      expect(await rawPost(s.url, { origin: 'http://evil.example' }, LIST)).toBe(403);
    } finally {
      await s.close();
    }
  }, 60_000);

  it('corpo oltre il limite: 413', async () => {
    const big = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { pad: 'x'.repeat(MAX_REQUEST_BODY_BYTES + 1) } });
    expect(await rawPost(server.url, {}, big)).toBe(413);
  });
});

describe('determinismo', () => {
  it('stessa chiamata, stesso output (anche su una seconda istanza con lo stesso seed)', async () => {
    const second = await startServer({ port: 0, seed: SEED, contracts });
    const other = await connect(second.url);
    try {
      for (const tool of TOOLS.filter((t) => t !== 'get_case_timeline')) {
        const args = example(tool) ?? {};
        const a = await call(client, tool, args);
        const b = await call(client, tool, args);
        const c = await call(other, tool, args);
        expect(b.structuredContent).toEqual(a.structuredContent);
        expect(c.structuredContent).toEqual(a.structuredContent);
      }
    } finally {
      await other.close();
      await second.close();
    }
  }, 60_000);

  it('seed diverso, dataset diverso', async () => {
    const second = await startServer({ port: 0, seed: SEED + 1, contracts });
    const other = await connect(second.url);
    try {
      const a = await call(client, 'get_portfolio_summary', {});
      const b = await call(other, 'get_portfolio_summary', {});
      expect((b.structuredContent!.meta as { seed: number }).seed).toBe(SEED + 1);
      expect(b.structuredContent!.exposure).not.toEqual(a.structuredContent!.exposure);
    } finally {
      await other.close();
      await second.close();
    }
  }, 60_000);
});
