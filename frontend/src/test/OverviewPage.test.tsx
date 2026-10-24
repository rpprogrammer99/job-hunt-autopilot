import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Application } from "../types";

let mockApps: Application[];
vi.mock("../context/DataContext", () => ({
  useData: () => ({
    applications: mockApps,
    loading: false,
    error: null,
    backendLabel: "Local demo",
    refresh: vi.fn(),
    changeStatus: vi.fn(),
    deleteApplication: vi.fn(),
    addImported: vi.fn(),
    resetToDemo: vi.fn(),
    clearError: vi.fn(),
  }),
}));

import { OverviewPage } from "../pages/OverviewPage";

function app(p: Partial<Application>): Application {
  return {
    id: p.id ?? "a1",
    company: p.company ?? "Acme",
    jobTitle: p.jobTitle ?? "Engineer",
    status: p.status ?? "applied",
    emailDate: p.emailDate ?? "2026-10-01T00:00:00Z",
    lastUpdated: p.lastUpdated ?? "2026-10-01T00:00:00Z",
    nextFollowUp: p.nextFollowUp ?? null,
    source: p.source ?? "demo",
    email: p.email ?? { from: "x@acme.com", subject: "Hi", receivedAt: "", snippet: "" },
    scam: p.scam ?? { suspicious: false, reasons: [], provider: "demo" },
    ...p,
  };
}

beforeEach(() => {
  mockApps = [
    app({ id: "1", status: "applied" }),
    app({ id: "2", status: "interview", company: "Brightwave" }),
    app({ id: "3", status: "offer", company: "Quantum" }),
  ];
});

describe("OverviewPage", () => {
  it("renders metric cards with real counts", () => {
    render(<OverviewPage onNavigate={vi.fn()} />);
    expect(screen.getByText("Total Applications")).toBeInTheDocument();
    expect(screen.getByText("Interviews")).toBeInTheDocument();
    // Total value 3 appears as a metric value.
    expect(screen.getAllByText("3").length).toBeGreaterThan(0);
  });

  it("navigates to filtered applications when a metric is clicked", () => {
    const onNavigate = vi.fn();
    render(<OverviewPage onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("button", { name: /Interviews/ }));
    expect(onNavigate).toHaveBeenCalledWith("applications", { status: "interview" });
  });

  it("shows empty onboarding state when there are no applications", () => {
    mockApps = [];
    render(<OverviewPage onNavigate={vi.fn()} />);
    expect(screen.getByText("No applications yet")).toBeInTheDocument();
  });

  it("shows security insights as clear when nothing is flagged", () => {
    render(<OverviewPage onNavigate={vi.fn()} />);
    expect(
      screen.getByText(/No applications are currently flagged/),
    ).toBeInTheDocument();
  });
});
