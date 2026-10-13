import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js';
import { generateDataset } from '../../analytics-engine/src/index.ts';
import { Contracts } from './contracts.ts';
import { HANDLERS } from './tools/index.ts';
import { ToolError, type ToolContext } from './tools/types.ts';

export interface StartOptions {
  host?: string;
  /** 0 = porta casuale. */
  port: number;
  seed: number;
  /** Origini aggiuntive ammesse. Le richieste senza header Origin (client non browser) sono sempre ammesse. */
  allowedOrigins?: string[];
  contracts?: Contracts;
}

/** Limite esplicito al corpo delle richieste (gli input dei tool sono piccoli). */
export const MAX_REQUEST_BODY_BYTES = 64 * 1024;

export interface RunningServer {
  url: string;
  port: number;
  close(): Promise<void>;
}

const textResult = (text: string, isError = false) => ({ content: [{ type: 'text' as const, text }], ...(isError && { isError: true }) });

/** Un'istanza MCP (stateless): il calcolo e una funzione pura di (dataset, input). */
function buildMcpServer(contracts: Contracts, ctx: ToolContext): Server {
  const server = new Server({ name: 'collection-copilot-mcp-mock', version: '0.1.0' }, { capabilities: { tools: {} } });
  const names = Object.keys(HANDLERS);

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: names.map((name) => ({
      name,
      description: contracts.definition(name).description,
      inputSchema: contracts.bundled(name, 'input') as { type: 'object' },
      outputSchema: contracts.bundled(name, 'output') as { type: 'object' },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, (request) => {
    const { name } = request.params;
    const handler = HANDLERS[name];
    if (!handler) throw new McpError(ErrorCode.InvalidParams, `Tool sconosciuto: ${name}`);

    const args = request.params.arguments ?? {};
    const inputErrors = contracts.validate(name, 'input', args);
    if (inputErrors) return textResult(`Input non valido per ${name}: ${inputErrors.join('; ')}`, true);

    let output: unknown;
    try {
      output = handler(ctx, args);
    } catch (e) {
      if (e instanceof ToolError) return textResult(e.message, true);
      throw new McpError(ErrorCode.InternalError, `Errore interno in ${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
    // Un output fuori contratto e un difetto del server, non un errore dell'utente.
    const outputErrors = contracts.validate(name, 'output', output);
    if (outputErrors) throw new McpError(ErrorCode.InternalError, `Output di ${name} non conforme al contratto: ${outputErrors.join('; ')}`);
    return { content: [{ type: 'text' as const, text: JSON.stringify(output) }], structuredContent: output as Record<string, unknown> };
  });

  return server;
}

export async function startServer(options: StartOptions): Promise<RunningServer> {
  const host = options.host ?? '127.0.0.1';
  const contracts = options.contracts ?? new Contracts();
  const dataset = generateDataset(options.seed);
  const ctx: ToolContext = { dataset, dataSourceId: `synthetic-dataset-seed-${options.seed}` };
  // Host e Origin ammessi dipendono dalla porta effettiva: finche non sono pronti (bind non completato) si risponde 503.
  let allowed: { hosts: string[]; origins: string[] } | null = null;

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    const send = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { 'content-type': 'application/json', ...headers }).end(JSON.stringify(body));
    };
    if (path !== '/mcp') return send(404, { error: 'Non trovato: l\'endpoint MCP e /mcp' });
    if (req.method !== 'POST') {
      return send(405, { jsonrpc: '2.0', error: { code: -32000, message: 'Metodo non consentito: server stateless, usare POST' }, id: null }, { allow: 'POST' });
    }
    if (!allowed) return send(503, { error: 'Server in avvio' });
    const server = buildMcpServer(contracts, ctx);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
      enableDnsRebindingProtection: true,
      allowedHosts: allowed.hosts,
      allowedOrigins: allowed.origins,
      maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
    });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  };

  const http: HttpServer = createServer((req, res) => {
    handle(req, res).catch((e: unknown) => {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: e instanceof Error ? e.message : 'Errore interno' }, id: null }));
    });
  });
  await new Promise<void>((resolve, reject) => {
    http.once('error', reject);
    http.listen(options.port, host, resolve);
  });
  const port = (http.address() as AddressInfo).port;
  allowed = {
    hosts: [`${host}:${port}`, `localhost:${port}`],
    origins: [`http://${host}:${port}`, `http://localhost:${port}`, ...(options.allowedOrigins ?? [])],
  };

  return {
    url: `http://${host}:${port}/mcp`,
    port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        http.close((err) => (err ? reject(err) : resolve()));
        http.closeAllConnections();
      }),
  };
}
