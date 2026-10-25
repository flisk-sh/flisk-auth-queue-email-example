import { Hono } from 'hono';
import type { Claims, Verify } from './auth';
import { type ReportRequested, type ReportStatus, SUBJECT_REQUESTED, SUBJECT_STATUS } from './events';
import type { Queue } from './queue';
import type { ReportStore } from './store';

type Env = { Variables: { user: Claims } };

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

export async function createApp(deps: { verify: Verify; queue: Queue; store: ReportStore }) {
  const app = new Hono<Env>();

  // The Vue app runs on its own origin and calls this API directly.
  app.use('*', async (c, next) => {
    c.header('Access-Control-Allow-Origin', '*');
    c.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    c.header('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    if (c.req.method === 'OPTIONS') return c.body(null, 204);
    await next();
  });

  app.get('/health', (c) => c.json({ status: 'ok', service: 'reports-api' }));

  app.use('/api/*', async (c, next) => {
    const header = c.req.header('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) return c.json({ error: 'missing bearer token' }, 401);
    try {
      c.set('user', await deps.verify(token));
    } catch (error) {
      return c.json({ error: 'invalid token', detail: (error as Error).message }, 401);
    }
    await next();
  });

  app.get('/api/me', (c) => c.json({ data: c.get('user') }));

  app.get('/api/reports', async (c) => {
    const { sub } = c.get('user');
    return c.json({ data: await deps.store.listForUser(sub) });
  });

  app.post('/api/reports', async (c) => {
    const user = c.get('user');
    if (!user.email) return c.json({ error: 'your token has no email claim to send the report to' }, 400);

    const body = await c.req.json().catch(() => null);
    const period = typeof body?.period === 'string' ? body.period : '';
    if (!PERIOD.test(period)) return c.json({ error: 'period must look like 2026-08' }, 400);

    const report = await deps.store.create({
      userId: user.sub,
      period,
      crashFirstAttempt: body?.crashFirstAttempt === true,
    });

    const message: ReportRequested = {
      reportId: report.id,
      userId: user.sub,
      email: user.email,
      period,
      crashFirstAttempt: report.crashFirstAttempt,
    };
    await deps.queue.publish(SUBJECT_REQUESTED, message);
    return c.json({ data: report }, 202);
  });

  // The worker reports progress over the queue; the API never calls it directly.
  await deps.queue.subscribe(SUBJECT_STATUS, 'reports-api-status', async (raw) => {
    const event = raw as ReportStatus;
    await deps.store.apply(event.reportId, event);
  });

  return app;
}
