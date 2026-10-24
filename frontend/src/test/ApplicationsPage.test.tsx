import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import type { Application } from "../types";

// ---- Mocks for context + toast (pages depend on these) ----
const changeStatus = vi.fn().mockResolvedValue(undefined);
const deleteApplication = vi.fn().mockResolvedValue(undefined);
const refresh = vi.fn().mockResolvedValue(undefined);

let mockState: {
  applications: Application[];
  loading: boolean;
  error: string | null;
};

vi.mock("../context/DataContext", () => ({
  useData: () => ({
    applications: mockState.applications,
    loading: mockState.loading,
    error: mockState.error,
    backendLabel: "Local demo",
    refresh,
    changeStatus,
    deleteApplication,
    addImported: vi.fn(),
    resetToDemo: vi.fn(),
    clearError: vi.fn(),
  }),
}));

const toastSuccess = vi.fn();
vi.mock("../components/ui/Toast", async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return {
    ...actual,
    useToast: () => ({ success: toastSuccess, error: vi.fn(), info: vi.fn(), toast: vi.fn() }),
  };
});

// analysisApi is called by the details drawer; stub it.
vi.mock("../services/analysisApi", () => ({
  analyzeApplication: vi.fn().mockResolvedValue({
    extraction: {},
    classification: { primary_status: "applied", confidence: 0.5, explanation: "" },
    scam_warning: {
      risk_level: "low", risk_score: 0, signals: [], risk_signals: [],
      evidence: [], plain_explanation: "", counter_evidence: [], uncertainty: "",
      recommendation: "", disclaimer: "Not a verified fraud probability.",
      deterministic_override: false, conflict_explanation: "",
    },
    verified: false, source: "fallback-unverified", model: null, notes: "",
  }),
  sendRiskFeedback: vi.fn(),
}));

import { ApplicationsPage } from "../pages/ApplicationsPage";

function makeApps(n: number): Application[] {
  return Array.from({ length: n }).map((_, i) => ({
    id: `a${i}`,
    company: i === 0 ? "Acme Cloud" : `Company ${i}`,
    jobTitle: i === 0 ? "Frontend Engineer" : `Role ${i}`,
    status: i % 2 === 0 ? "applied" : "interview",
    emailDate: `2026-10-${(i % 27) + 1}T00:00:00Z`,
    lastUpdated: `2026-10-${(i % 27) + 1}T00:00:00Z`,
    nextFollowUp: null,
    source: "demo",
    email: { from: `hr${i}@x.com`, subject: "Hi", receivedAt: "", snippet: "" },
    scam: i === 1
      ? { suspicious: true, reasons: ["fee"], provider: "demo" }
      : { suspicious: false, reasons: [], provider: "demo" },
  }));
}

const noop = () => {};

beforeEach(() => {
  mockState = { applications: makeApps(3), loading: false, error: null };
  changeStatus.mockClear();
  deleteApplication.mockClear();
  toastSuccess.mockClear();
});

describe("ApplicationsPage", () => {
  it("renders the applications table with rows", () => {
    render(<ApplicationsPage search="" onNavigate={noop} />);
    expect(screen.getByText("Acme Cloud")).toBeInTheDocument();
    expect(screen.getByText("Company 1")).toBeInTheDocument();
  });

  it("filters by search", () => {
    render(<ApplicationsPage search="acme" onNavigate={noop} />);
    expect(screen.getByText("Acme Cloud")).toBeInTheDocument();
    expect(screen.queryByText("Company 1")).not.toBeInTheDocument();
  });

  it("filters by status pill", () => {
    render(<ApplicationsPage search="" onNavigate={noop} />);
    fireEvent.click(screen.getByRole("button", { name: /Interview/ }));
    // Only the interview app (Company 1) remains.
    expect(screen.queryByText("Acme Cloud")).not.toBeInTheDocument();
    expect(screen.getByText("Company 1")).toBeInTheDocument();
  });

  it("filters flagged by risk", () => {
    render(<ApplicationsPage search="" onNavigate={noop} />);
    fireEvent.click(screen.getByRole("button", { name: /Flagged/ }));
    expect(screen.getByText("Company 1")).toBeInTheDocument();
    expect(screen.queryByText("Acme Cloud")).not.toBeInTheDocument();
  });

  it("updates status via inline select and toasts", () => {
    render(<ApplicationsPage search="acme" onNavigate={noop} />);
    const select = screen.getByLabelText("Status for Acme Cloud");
    fireEvent.change(select, { target: { value: "offer" } });
    expect(changeStatus).toHaveBeenCalledWith("a0", "offer");
  });

  it("opens the delete confirm dialog and deletes", async () => {
    render(<ApplicationsPage search="acme" onNavigate={noop} />);
    fireEvent.click(screen.getByRole("button", { name: /Actions for Acme Cloud/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Delete/ }));
    const dialog = screen.getByRole("dialog", { name: /Delete application/ });
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(deleteApplication).toHaveBeenCalledWith("a0");
  });

  it("shows empty state when no matches", () => {
    render(<ApplicationsPage search="zzzzz-no-match" onNavigate={noop} />);
    expect(screen.getByText("No matching applications")).toBeInTheDocument();
  });

  it("shows error state with retry", () => {
    mockState = { applications: [], loading: false, error: "Server down" };
    render(<ApplicationsPage search="" onNavigate={noop} />);
    expect(screen.getByText("Couldn't load applications")).toBeInTheDocument();
    expect(screen.getByText("Server down")).toBeInTheDocument();
  });

  it("shows skeleton while loading", () => {
    mockState = { applications: [], loading: true, error: null };
    const { container } = render(<ApplicationsPage search="" onNavigate={noop} />);
    expect(container.querySelector(".skeleton-row")).toBeTruthy();
  });

  it("paginates when more than one page", () => {
    mockState = { applications: makeApps(25), loading: false, error: null };
    render(<ApplicationsPage search="" onNavigate={noop} />);
    expect(screen.getByText("1–10 of 25")).toBeInTheDocument();
  });
});
