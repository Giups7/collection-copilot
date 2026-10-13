import { loadConfig } from './config.ts';
import { startServer } from './server.ts';

const config = loadConfig();
const server = await startServer({ host: config.host, port: config.port, seed: config.seed, allowedOrigins: config.allowedOrigins });
console.log(`MCP mock in ascolto su ${server.url} (dataset sintetico, seed ${config.seed})`);

const stop = () => {
  void server.close().finally(() => process.exit(0));
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
