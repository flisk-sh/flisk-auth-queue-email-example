/**
 * Where reports are kept. PostgresReportStore (postgres-store.ts) is what runs; InMemoryReportStore
 * is the test double, so the API tests need no database.
 */
export interface Report {
  id: string;
  userId: string;
  period: string;
  status: 'queued' | 'processing' | 'retrying' | 'sent' | 'failed';
  attempts: number;
  crashFirstAttempt: boolean;
  rows?: number;
  sentTo?: string;
  error?: string;
  requestedAt: string;
  updatedAt: string;
}

export interface NewReport {
  userId: string;
  period: string;
  crashFirstAttempt: boolean;
}

/** A status event from the worker. Only the fields the worker sent are changed. */
export interface ReportUpdate {
  status: Report['status'];
  attempt: number;
  rows?: number;
  sentTo?: string;
  error?: string;
  at: string;
}

export interface ReportStore {
  /** Creates the report and returns it with its id. */
  create(draft: NewReport): Promise<Report>;
  listForUser(userId: string): Promise<Report[]>;
  /** Applies a worker event. Returns false when no report has that id. */
  apply(reportId: string, update: ReportUpdate): Promise<boolean>;
}

export class InMemoryReportStore implements ReportStore {
  private readonly reports = new Map<string, Report>();
  private nextId = 1;

  async create(draft: NewReport): Promise<Report> {
    const now = new Date().toISOString();
    const report: Report = {
      id: `r_${this.nextId++}`,
      userId: draft.userId,
      period: draft.period,
      status: 'queued',
      attempts: 0,
      crashFirstAttempt: draft.crashFirstAttempt,
      requestedAt: now,
      updatedAt: now,
    };
    this.reports.set(report.id, report);
    return report;
  }

  async listForUser(userId: string): Promise<Report[]> {
    return [...this.reports.values()].filter((r) => r.userId === userId).reverse();
  }

  async apply(reportId: string, event: ReportUpdate): Promise<boolean> {
    const report = this.reports.get(reportId);
    if (!report) return false;
    report.status = event.status;
    report.attempts = Math.max(report.attempts, event.attempt);
    report.rows = event.rows ?? report.rows;
    report.sentTo = event.sentTo ?? report.sentTo;
    report.error = event.error;
    report.updatedAt = event.at;
    return true;
  }
}
