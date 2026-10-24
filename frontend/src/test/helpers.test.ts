import { describe, it, expect } from "vitest";
import {
  filterApplications,
  sortApplications,
  buildPipeline,
  isFollowUpDue,
  formatDate,
} from "../lib/helpers";
import type { Application } from "../types";

function app(partial: Partial<Application>): Application {
  return {
    id: partial.id ?? "a1",
    company: partial.company ?? "Acme",
    jobTitle: partial.jobTitle ?? "Engineer",
    status: partial.status ?? "applied",
    emailDate: partial.emailDate ?? "2026-10-01T00:00:00Z",
    lastUpdated: partial.lastUpdated ?? "2026-10-01T00:00:00Z",
    nextFollowUp: partial.nextFollowUp ?? null,
    source: partial.source ?? "demo",
    email: partial.email ?? { from: "x@acme.com", subject: "Hi", receivedAt: "", snippet: "" },
    scam: partial.scam ?? { suspicious: false, reasons: [], provider: "demo" },
    ...partial,
  };
}

describe("filterApplications", () => {
  const apps = [
    app({ id: "1", company: "Acme", status: "applied", email: { from: "x@acme.com", subject: "Hi", receivedAt: "", snippet: "" } }),
    app({ id: "2", company: "Brightwave", status: "interview", email: { from: "jobs@brightwave.io", subject: "Interview", receivedAt: "", snippet: "" } }),
  ];
  it("filters by status", () => {
    const r = filterApplications(apps, { search: "", status: "interview" });
    expect(r).toHaveLength(1);
    expect(r[0].company).toBe("Brightwave");
  });
  it("filters by search across company", () => {
    const r = filterApplications(apps, { search: "acme", status: "all" });
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe("1");
  });
  it("returns all when no filter", () => {
    expect(filterApplications(apps, { search: "", status: "all" })).toHaveLength(2);
  });
});

describe("sortApplications", () => {
  const apps = [
    app({ id: "1", company: "Zeta" }),
    app({ id: "2", company: "Alpha" }),
  ];
  it("sorts by company asc", () => {
    const r = sortApplications(apps, { field: "company", direction: "asc" });
    expect(r[0].company).toBe("Alpha");
  });
  it("sorts by company desc", () => {
    const r = sortApplications(apps, { field: "company", direction: "desc" });
    expect(r[0].company).toBe("Zeta");
  });
});

describe("buildPipeline", () => {
  it("counts each status and percentages sum to 100", () => {
    const apps = [
      app({ status: "applied" }),
      app({ status: "applied" }),
      app({ status: "interview" }),
      app({ status: "offer" }),
    ];
    const p = buildPipeline(apps);
    expect(p.find((s) => s.status === "applied")!.count).toBe(2);
    const sum = p.reduce((acc, s) => acc + s.pct, 0);
    expect(Math.round(sum)).toBe(100);
  });
});

describe("isFollowUpDue", () => {
  it("is due when nextFollowUp is in the past and status open", () => {
    expect(isFollowUpDue(app({ status: "applied", nextFollowUp: "2000-01-01T00:00:00Z" }))).toBe(true);
  });
  it("is not due for rejected", () => {
    expect(isFollowUpDue(app({ status: "rejected", nextFollowUp: "2000-01-01T00:00:00Z" }))).toBe(false);
  });
  it("is not due when nextFollowUp is in the future", () => {
    expect(isFollowUpDue(app({ status: "applied", nextFollowUp: "2999-01-01T00:00:00Z" }))).toBe(false);
  });
});

describe("formatDate", () => {
  it("returns em dash for null", () => {
    expect(formatDate(null)).toBe("—");
  });
  it("formats a valid ISO date", () => {
    expect(formatDate("2026-10-15T00:00:00Z")).toMatch(/2026/);
  });
});
