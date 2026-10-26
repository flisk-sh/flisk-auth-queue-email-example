import { SQL } from 'bun';
import { createApp } from './app';
import { createVerifier } from './auth';
import { cleanDatabaseUrl } from './db';
import { NatsQueue } from './nats-queue';
import { PostgresReportStore } from './postgres-store';

const need = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (see params in service.json)`);
  return value;
};

// TILT_NATS_URL is injected by Flisk for every backend. DATABASE_URL comes from the prisma feature;
// the schema is applied by reports-migrator before this starts.
const queue = await NatsQueue.connect(process.env.NATS_URL || need('TILT_NATS_URL'));
const store = new PostgresReportStore(new SQL(cleanDatabaseUrl(need('DATABASE_URL'))));

const app = await createApp({
  verify: createVerifier({
    issuer: need('OIDC_ISSUER'),
    jwksUrl: need('OIDC_JWKS_URL'),
    audience: need('OIDC_AUDIENCE'),
  }),
  queue,
  store,
});

const port = process.env.PORT || 3000;
console.log(`\n🚀 reports-api running on http://localhost:${port}`);

export default {
  port,
  fetch: app.fetch,
};
