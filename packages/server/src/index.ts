import { config } from '@recipe/core';
import { buildApp } from './app.js';
import { openDb } from './db.js';
import { PendingQuestions, RunEvents } from './events.js';
import { JobWorker } from './worker.js';

const { db, close } = openDb(config.DATABASE_PATH);
const events = new RunEvents();
const questions = new PendingQuestions(events);
const worker = new JobWorker({ db, config, events, questions });
const app = await buildApp({ config, db, events, questions, worker, logger: true });

const shutdown = async () => {
  await app.close();
  await worker.stop();
  close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

try {
  worker.start();
  await app.listen({ port: config.PORT, host: '127.0.0.1' });
  app.log.info(`AI provider: ${config.AI_PROVIDER} · runs: ${config.RUNS_DIR} · db: ${config.DATABASE_PATH}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
