import { describe, expect, it } from 'vitest';
import { DEFAULT_CORS_ORIGIN } from '../src/app.ts';
import { resolveConfig, UI_PROFILE } from '../src/config.ts';
import { readSse, scenariosCopy, startMock, type Mock } from './helpers.ts';

const SCENARIO = 'classifica';
const hdr = { 'X-Mock-Scenario': SCENARIO };

async function withMock(options: Parameters<typeof startMock>[0], fn: (m: Mock) => Promise<void>): Promise<void> {
  const m = await startMock(options);
  try {
    await fn(m);
  } finally {
    await m.close();
  }
}

const timed = async (m: Mock) => {
  const acc = await (await m.post('x', hdr)).json();
  const t0 = performance.now();
  const { events } = await readSse(await m.api(acc.eventsUrl));
  return { ms: performance.now() - t0, events };
};

describe('ritmo dello streaming', () => {
  it('il ritardo globale si applica tra gli eventi', async () => {
    await withMock({ eventDelayMs: 25 }, async (m) => {
      const { ms, events } = await timed(m);
      expect(ms).toBeGreaterThanOrEqual(25 * (events.length - 1) - 5);
    });
  });

  it('il ritardo di scenario sovrascrive quello globale (sia piu lento sia piu veloce)', async () => {
    const slow = scenariosCopy({ [SCENARIO]: (s) => (s.streaming = { delayMs: 25 }) });
    await withMock({ scenariosDir: slow, eventDelayMs: 0 }, async (m) => {
      const { ms, events } = await timed(m);
      expect(ms).toBeGreaterThanOrEqual(25 * (events.length - 1) - 5);
    });
    const fast = scenariosCopy({ [SCENARIO]: (s) => (s.streaming = { delayMs: 0 }) });
    await withMock({ scenariosDir: fast, eventDelayMs: 300 }, async (m) => {
      const { ms } = await timed(m);
      expect(ms).toBeLessThan(300);
    });
  });
});

describe('interruzioni simulate', () => {
  async function dropAndResume(m: Mock, n: number) {
    const acc = await (await m.post('x', hdr)).json();
    const first = await m.api(acc.eventsUrl).then(readSse);
    expect(first.aborted).toBe(true);
    expect(first.events).toHaveLength(n);
    expect(first.events.some((e) => e.event === 'done')).toBe(false);
    const lastSeq = first.events.at(-1)!.seq;
    const rest = await m.api(acc.eventsUrl, { headers: { 'Last-Event-ID': String(lastSeq) } }).then(readSse);
    expect(rest.aborted).toBe(false);
    expect(rest.events.at(-1)!.event).toBe('done');
    const all = [...first.events, ...rest.events];
    expect(all.map((e) => e.seq)).toEqual(all.map((_, i) => i));
  }

  it('opzione globale: chiude dopo N eventi, la ripresa con Last-Event-ID completa lo stream', async () => {
    await withMock({ dropAfterEvents: 3 }, (m) => dropAndResume(m, 3));
  });

  it('per scenario: sovrascrive l\'opzione globale', async () => {
    const dir = scenariosCopy({ [SCENARIO]: (s) => (s.streaming = { dropAfterEvents: 2 }) });
    await withMock({ scenariosDir: dir, dropAfterEvents: 5 }, (m) => dropAndResume(m, 2));
  });

  it('senza interruzione configurata lo stream arriva fino a done', async () => {
    await withMock({}, async (m) => {
      const acc = await (await m.post('x', hdr)).json();
      const r = await readSse(await m.api(acc.eventsUrl));
      expect(r.aborted).toBe(false);
      expect(r.events.at(-1)!.event).toBe('done');
    });
  });

  it('il risultato completo resta disponibile dopo un\'interruzione', async () => {
    await withMock({ dropAfterEvents: 1 }, async (m) => {
      const acc = await (await m.post('x', hdr)).json();
      await readSse(await m.api(acc.eventsUrl));
      const result = await (await m.api(acc.resultUrl)).json();
      expect(result.status).toBe('COMPLETED');
    });
  });
});

describe('CORS', () => {
  const preflight = (m: Mock, path = '/v1/copilot/requests') =>
    fetch(m.base + path, {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:4200', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' },
    });

  it('preflight: 204 senza Bearer, con header Allow-* ed Expose-Headers', async () => {
    await withMock({ cors: true }, async (m) => {
      for (const path of ['/v1/copilot/requests', '/v1/copilot/requests/r-x/events', '/v1/copilot/capabilities']) {
        const res = await preflight(m, path);
        expect(res.status, path).toBe(204);
        expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:4200');
        const allowed = res.headers.get('access-control-allow-headers')!.split(',').map((h) => h.trim().toLowerCase());
        for (const h of ['authorization', 'content-type', 'idempotency-key', 'x-correlation-id', 'x-mock-scenario', 'last-event-id']) {
          expect(allowed, h).toContain(h);
        }
        expect(res.headers.get('access-control-allow-methods')).toMatch(/GET.*POST.*OPTIONS/);
        expect(res.headers.get('access-control-expose-headers')).toBe('X-Correlation-Id');
      }
    });
  });

  it('origine configurabile; gli header sono presenti anche su 202, SSE, 401 e 404', async () => {
    await withMock({ cors: true, corsOrigin: 'http://localhost:5173' }, async (m) => {
      expect((await preflight(m)).headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
      const accepted = await m.post('x', hdr);
      const acc = await accepted.clone().json();
      const responses = [
        accepted,
        await m.api(acc.eventsUrl),
        await m.api(acc.resultUrl),
        await fetch(m.base + '/v1/copilot/capabilities'),
        await m.api('/v1/copilot/requests/r-nope'),
      ];
      expect(responses.map((r) => r.status)).toEqual([202, 200, 200, 401, 404]);
      for (const r of responses) {
        expect(r.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
        expect(r.headers.get('access-control-expose-headers')).toBe('X-Correlation-Id');
      }
      await Promise.all(responses.map((r) => r.text()));
    });
  });

  it('disattivo di default: nessun header CORS e OPTIONS non risponde 204', async () => {
    await withMock({}, async (m) => {
      const res = await preflight(m);
      expect(res.status).not.toBe(204);
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });
  });
});

describe('configurazione e profilo ui', () => {
  it('default: porta 8080, nessun ritardo, CORS spento', () => {
    expect(resolveConfig([], {})).toEqual({ port: 8080, eventDelayMs: 0, cors: false, corsOrigin: DEFAULT_CORS_ORIGIN });
  });

  it('profilo ui: CORS attivo, ritardo realistico, porta 8080', () => {
    const c = resolveConfig(['--profile', 'ui'], {});
    expect(c).toMatchObject({ port: 8080, cors: true, corsOrigin: 'http://localhost:4200' });
    expect(c.eventDelayMs).toBe(UI_PROFILE.eventDelayMs);
    expect(c.eventDelayMs).toBeGreaterThan(0);
    expect(resolveConfig([], { MOCK_PROFILE: 'ui' }).cors).toBe(true);
  });

  it('le variabili d\'ambiente sovrascrivono il profilo', () => {
    const c = resolveConfig(['--profile', 'ui'], {
      PORT: '9090', MOCK_EVENT_DELAY_MS: '50', MOCK_CORS: 'false', MOCK_CORS_ORIGIN: 'http://x:1', MOCK_DROP_AFTER_EVENTS: '4',
    });
    expect(c).toEqual({ port: 9090, eventDelayMs: 50, cors: false, corsOrigin: 'http://x:1', dropAfterEvents: 4 });
    expect(resolveConfig([], { MOCK_CORS: '1' }).cors).toBe(true);
  });

  it('valori non validi -> errore', () => {
    expect(() => resolveConfig(['--profile', 'boh'], {})).toThrow(/Profilo/);
    expect(() => resolveConfig([], { MOCK_EVENT_DELAY_MS: 'abc' })).toThrow(/MOCK_EVENT_DELAY_MS/);
  });
});
