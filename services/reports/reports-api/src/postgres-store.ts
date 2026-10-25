import type { SQL } from 'bun';
import type { NewReport, Report, ReportStore, ReportUpdate } from './store';

// What a row looks like on the way out: Postgres names are snake_case, the API's are camelCase.
interface Row {
  id: string;
  userId: string;
  period: string;
  status: Report['status'];
  attempts: number;
  crashFirstAttempt: boolean;
  rows: number | null;
  sentTo: string | null;
  error: string | null;
  requestedAt: Date;
  updatedAt: Date;
}

// Optional fields are left out when null, the way the in-memory store leaves them unset.
function toReport(row: Row): Report {
  const report: Report = {
    id: row.id,
    userId: row.userId,
    period: row.period,
    status: row.status,
    attempts: row.attempts,
    crashFirstAttempt: row.crashFirstAttempt,
    requestedAt: row.requestedAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
  if (row.rows !== null) report.rows = row.rows;
  if (row.sentTo !== null) report.sentTo = row.sentTo;
  if (row.error !== null) report.error = row.error;
  return report;
}

// Reports in Postgres (see reports-migrator). `seq` orders them; `id` is r_<seq>, the id the API hands out.
export class PostgresReportStore implements ReportStore {
  constructor(private readonly sql: SQL) {}

  async create(draft: NewReport): Promise<Report> {
    const [row] = await this.sql<Row[]>`insert into reports (user_id, period, crash_first_attempt)
      values (${draft.userId}, ${draft.period}, ${draft.crashFirstAttempt})
      returning id, user_id as "userId", period, status, attempts, crash_first_attempt as "crashFirstAttempt",
        row_count as "rows", sent_to as "sentTo", error, requested_at as "requestedAt", updated_at as "updatedAt"`;
    return toReport(row);
  }

  async listForUser(userId: string): Promise<Report[]> {
    const rows = await this.sql<Row[]>`select id, user_id as "userId", period, status, attempts,
        crash_first_attempt as "crashFirstAttempt", row_count as "rows", sent_to as "sentTo", error,
        requested_at as "requestedAt", updated_at as "updatedAt"
      from reports where user_id = ${userId} order by seq desc`;
    return rows.map(toReport);
  }

  async apply(reportId: string, event: ReportUpdate): Promise<boolean> {
    const rows = await this.sql`update reports set
        status = ${event.status},
        attempts = greatest(attempts, ${event.attempt}),
        row_count = coalesce(${event.rows ?? null}, row_count),
        sent_to = coalesce(${event.sentTo ?? null}, sent_to),
        error = ${event.error ?? null},
        updated_at = ${event.at}::timestamptz
      where id = ${reportId}
      returning id`;
    return rows.length > 0;
  }
}
