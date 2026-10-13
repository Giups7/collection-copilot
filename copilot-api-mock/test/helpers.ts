import { expect } from 'vitest';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMockServer, type MockOptions } from '../src/app.ts';
import { loadContracts } from '../src/contracts.ts';
import { DEFAULT_SCENARIOS_DIR } from '../src/scenarios.ts';

export const contracts = loadContracts();
export const check = (ref: string, doc: unknown) => {
  expect(contracts.validator(ref)(doc), JSON.stringify(doc).slice(0, 300)).toEqual([]);
};

export const auth = { Authorization: 'Bearer qualunque-token' };

export function parseSse(text: string) {
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

/** Legge uno stream SSE fino alla fine; se la connessione cade restituisce quanto ricevuto e `aborted: true`. */
export async function readSse(res: Response): Promise<{ events: ReturnType<typeof parseSse>; aborted: boolean }> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let aborted = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
  } catch {
    aborted = true;
  }
  // scarta un eventuale evento troncato dall'interruzione
  const complete = text.slice(0, text.lastIndexOf('\n\n') + 2);
  return { events: parseSse(complete), aborted };
}

export interface Mock {
  server: Server;
  base: string;
  api(path: string, init?: RequestInit & { headers?: Record<string, string> }): Promise<Response>;
  post(message: string, headers?: Record<string, string>, extra?: object): Promise<Response>;
  close(): Promise<void>;
}

export async function startMock(options: MockOptions = {}): Promise<Mock> {
  const server = createMockServer(options);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const api: Mock['api'] = (path, init = {}) => fetch(base + path, { ...init, headers: { ...auth, ...init.headers } });
  const post: Mock['post'] = (message, headers = {}, extra = {}) =>
    api('/v1/copilot/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ message, ...extra }),
    });
  return { server, base, api, post, close: () => new Promise<void>((r) => server.close(() => r())) };
}

/** Copia degli scenari in una cartella temporanea, con possibilita di modificare uno scenario.json. */
export function scenariosCopy(patch: Record<string, (scenario: any) => void> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'copilot-mock-scenarios-'));
  cpSync(DEFAULT_SCENARIOS_DIR, dir, { recursive: true });
  for (const [id, fn] of Object.entries(patch)) {
    const file = join(dir, id, 'scenario.json');
    const scenario = JSON.parse(readFileSync(file, 'utf8'));
    fn(scenario);
    writeFileSync(file, JSON.stringify(scenario, null, 2));
  }
  return dir;
}
