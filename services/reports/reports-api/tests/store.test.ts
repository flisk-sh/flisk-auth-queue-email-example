import { describe, expect, it } from "vitest";
import { InMemoryReportStore } from "../src/store";

describe("InMemoryReportStore", () => {
	it("does not let an older event from the same attempt undo a sent report", async () => {
		const store = new InMemoryReportStore();
		const report = await store.create({
			userId: "alice",
			period: "2026-08",
			crashFirstAttempt: false,
		});
		const sentAt = "2026-09-01T00:00:02.000Z";

		expect(
			await store.apply(report.id, {
				status: "sent",
				attempt: 2,
				at: sentAt,
				rows: 30,
				sentTo: "alice@example.test",
			}),
		).toBe(true);
		expect(
			await store.apply(report.id, {
				status: "processing",
				attempt: 2,
				at: "2026-09-01T00:00:01.000Z",
			}),
		).toBe(false);

		const [stored] = await store.listForUser("alice");
		expect(stored).toMatchObject({
			status: "sent",
			attempts: 2,
			updatedAt: sentAt,
			rows: 30,
			sentTo: "alice@example.test",
		});
	});
});
