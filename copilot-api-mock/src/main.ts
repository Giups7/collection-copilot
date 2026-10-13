import { createMockServer } from './app.ts';
import { resolveConfig } from './config.ts';

let config: ReturnType<typeof resolveConfig>;
try {
  config = resolveConfig(process.argv.slice(2), process.env);
} catch (err) {
  console.error(`Configurazione non valida: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
const { port, ...options } = config;

createMockServer(options).listen(port, () => {
  const extra = [
    options.cors ? `CORS: ${options.corsOrigin}` : 'CORS: disattivo',
    ...(options.dropAfterEvents !== undefined ? [`interruzione dopo ${options.dropAfterEvents} eventi`] : []),
  ];
  console.log(`Copilot API mock in ascolto su http://localhost:${port} (ritardo eventi: ${options.eventDelayMs} ms; ${extra.join('; ')})`);
});
