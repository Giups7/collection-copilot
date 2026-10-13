import { createMockServer } from './app.ts';

const port = Number(process.env.PORT ?? 8080);
const eventDelayMs = Number(process.env.MOCK_EVENT_DELAY_MS ?? 0);

createMockServer({ eventDelayMs }).listen(port, () => {
  console.log(`Copilot API mock in ascolto su http://localhost:${port} (ritardo eventi: ${eventDelayMs} ms)`);
});
