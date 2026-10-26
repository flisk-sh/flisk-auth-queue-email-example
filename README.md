# Flisk Auth + Queue + Email Example (Vue + Hono + NATS)

**How do you run the parts of your stack that only exist as managed cloud services, like an identity provider, a queue or outbound email, on your laptop?**

This example answers that with one small app: sign in, click **Email me a usage report**, and a worker builds a CSV and emails it to you. Each managed service is a normal Flisk resource or container next to your code, and the app talks to an interface, not to a vendor.

| Managed service | Local stand-in | What the app depends on |
| --- | --- | --- |
| Identity provider (Auth0, Cognito, Entra ID) | [`auth-emulator`](services/identity/auth-emulator): an OIDC issuer with discovery, JWKS and a token endpoint | an issuer, a JWKS URL and an audience (`params` in [`reports-api/service.json`](services/reports/reports-api/service.json)) |
| Queue (SQS, Pub/Sub, Service Bus) | [NATS JetStream](services/platform/messaging/docker-compose.yml): durable, at-least-once, redelivers on failure | the [`Queue` interface](services/reports/reports-api/src/queue.ts) |
| Email (SES, SendGrid) | [Mailpit](services/platform/messaging/docker-compose.yml): an SMTP server with an inbox UI | the [`Mailer` interface](services/reports/report-worker/src/mailer.ts) |

![The report is retried after the worker crashed on its first attempt](docs/screenshots/03-retrying.png)

## What it looks like

| 1. Sign in | 2. Signed in as Alice |
| --- | --- |
| ![Sign-in screen](docs/screenshots/01-sign-in.png) | ![Signed in, ready to request a report](docs/screenshots/02-signed-in.png) |

| 3. Worker crashed, queue is retrying | 4. Second attempt succeeded |
| --- | --- |
| ![Report shown as Retrying, attempt 1](docs/screenshots/03-retrying.png) | ![Report shown as Emailed, attempt 2](docs/screenshots/04-emailed.png) |

| 5. The email arrived in Mailpit | 6. With the CSV attached |
| --- | --- |
| ![Mailpit inbox with one message](docs/screenshots/05-inbox.png) | ![The email with usage-2026-09.csv attached](docs/screenshots/06-email.png) |

## Run it


> **Repository-pinned CLI (optional):** Run `bun install` from the repository root to install the version pinned in `package.json`. Use `bun run flisk:project` to initialize project config, `bun run flisk:dry-run` to preview startup, or `bun run flisk:up -- <stack>` to start a stack. The global npm and standalone binary installation paths remain available.

> **Requires Flisk CLI 1.3.76 or newer** (1.3.75 for the Vue frontend's `"framework": "vue"`; 1.3.76 fixes `nats`/`mailpit` staying disabled, [flisk#155](https://github.com/flisk-sh/flisk/issues/155)). Prerequisites: Docker running, [Tilt](https://docs.tilt.dev/install.html), [Bun](https://bun.sh/docs/installation) and the [Flisk CLI](https://github.com/flisk-sh/flisk#installation).

```bash
git clone https://github.com/flisk-sh/tdk-auth-queue-email-example.git
cd tdk-auth-queue-email-example
flisk project        # creates .env and the generated config in a fresh clone
flisk up
```

The first start builds the images and takes a few minutes.

| Resource | Type | Stack | URL |
| --- | --- | --- | --- |
| [`web`](services/reports/web) | Vue 3 app | `reports` | http://app.tdk-auth-queue-email-example.localhost/reports/ |
| [`reports-api`](services/reports/reports-api) | Hono API | `reports` | http://api.tdk-auth-queue-email-example.localhost/api/reports |
| [`reports-migrator`](services/reports/reports-migrator) | migrator (runs once) | `reports` | none |
| [`report-worker`](services/reports/report-worker) | queue worker | `reports` | none (it has no HTTP server) |
| [`auth-emulator`](services/identity/auth-emulator) | Hono OIDC issuer | `identity` | http://api.tdk-auth-queue-email-example.localhost/api/auth-emulator |
| Mailpit | SMTP + inbox UI | infra | http://localhost:8025 |
| NATS | JetStream | infra | internal (`TILT_NATS_URL`) |

Sign in as **Alice** (`alice` / `alice-pass`) or **Bob** (`bob` / `bob-pass`). Tick **Crash the worker on the first attempt** to watch the queue redeliver the job: the report shows *Retrying*, then *Emailed* on attempt 2, and Mailpit holds exactly one email.

`flisk down` stops everything.

## How each piece stays cloud-ready

**Identity.** `reports-api` never asks the emulator anything special. It fetches signing keys from `OIDC_JWKS_URL` and checks signature, issuer and audience, as it would for Auth0 or Cognito ([`auth.ts`](services/reports/reports-api/src/auth.ts)). The user's email comes from the token's `email` claim, so the worker mails whoever the identity provider says the user is. Point the three `params` at your tenant to verify real tokens. The issuer the token carries (public URL) and the JWKS URL the API fetches from (internal `http://auth-emulator:4400/...`) are separate on purpose.

**Queue.** [`Queue`](services/reports/reports-api/src/queue.ts) has `publish` and `subscribe` with at-least-once semantics: resolve to acknowledge, throw to be redelivered. [`NatsQueue`](services/reports/reports-api/src/nats-queue.ts) implements it with JetStream. An SQS or Pub/Sub implementation is one more class. The worker reports progress back on a second subject, so the API never calls the worker. `report-worker` gives up after 3 attempts and reports `failed`, instead of retrying forever.

**Email.** [`Mailer`](services/reports/report-worker/src/mailer.ts) has one method. Locally it is plain SMTP into Mailpit, whose inbox shows what a real recipient would get, attachment included.

## What this does not do

Be clear about what a stand-in is:

- The emulator is **not a security product**. Users are hard-coded, and the signing key is regenerated on every start, so tokens die with the container. It does not do refresh tokens, MFA, social login or a redirect (authorization code + PKCE) flow. The password grant is only the shortest path to a token. A real provider needs a different sign-in step in `web`; the API side stays the same.
- Only `Queue` has one real implementation (NATS). Nothing here is tested against SQS, and JetStream is not SQS: ordering, visibility timeouts and dead-letter queues differ. Keep the interface small and test each real adapter against the real service.
- `SmtpMailer` sends without credentials. Using SES or SendGrid over SMTP needs `SMTP_USER` and `SMTP_PASSWORD` support, which is a few lines but not here.
- Flisk starts NATS only when `services/platform/messaging/docker-compose.yml` exists, and it does not generate that file. This repo ships one. The container name and network in it follow Flisk's naming (`<project>_nats`, `<project>_backend`).
- Reports are stored in Postgres. `reports-migrator` creates the table once before the API starts, and a restart keeps them. The API reads and writes them through [`PostgresReportStore`](services/reports/reports-api/src/postgres-store.ts).

## Test it

```bash
bun install
cd services/identity/auth-emulator && bunx vitest run
cd ../../reports/reports-api && bunx vitest run
cd ../report-worker && bunx vitest run
cd ../web && bunx vitest run && bun run build
```

21 tests. The queue and mailer have in-memory test doubles, so the retry behavior is tested without a broker: a crash on attempt 1 sends exactly one email on attempt 2, and a permanently failing mailer ends as `failed` after three attempts. The real token check (JWKS, issuer, audience) is not in the unit tests. Run the stack and sign in to exercise it.

`bun run build` runs `tsc && vite build --config .autogenerated/vite.config.build.autogenerated.ts`, the command the Docker image runs. The config file appears after the first `flisk up` (or `flisk config regenerate`).

`flisk doctor` checks this kind of wiring before you start: a resource without a `package.json`, a `params` URL that uses the wrong port for another service, a frontend calling a backend on `localhost:<port>`, the `nats` feature with no NATS to start.

## How it was made

```bash
mkdir tdk-auth-queue-email-example && cd tdk-auth-queue-email-example
flisk project --yes
flisk resource auth-emulator --type backend --stack identity
flisk resource reports-api --type backend --stack reports
flisk resource report-worker --type worker --stack reports
flisk resource web --type frontend --framework vue --stack reports
```

Resources live under `services/<stack>/<name>/`, which is where `discovery.paths` in `.flisk/project.json` looks. Each `service.json` is the whole Flisk contract for its service.

> [!IMPORTANT]
> Edit `service.json` or the sources. Never edit `.autogenerated/`; Flisk regenerates it.

The queue code is duplicated in `reports-api` and `report-worker` (and the `events.ts` message contract, which you must keep in sync). A shared Flisk `sdk` resource would remove that, at the cost of more moving parts for an example.

## License

MIT
