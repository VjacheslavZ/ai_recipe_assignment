import { config } from '@recipe/core';
import { buildApp } from './app.js';

const app = buildApp();

try {
  await app.listen({ port: config.PORT, host: '127.0.0.1' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
