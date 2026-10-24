import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("../context/DataContext", () => ({
  useData: () => ({
    applications: [],
    loading: false,
    error: null,
    backendLabel: "Local demo",
    refresh: vi.fn(),
    changeStatus: vi.fn(),
    deleteApplication: vi.fn(),
    addImported: vi.fn().mockResolvedValue(undefined),
    resetToDemo: vi.fn(),
    clearError: vi.fn(),
  }),
}));

const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), toast: vi.fn() };
vi.mock("../components/ui/Toast", async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useToast: () => toast };
});

// Backend offline so the Import page uses the local parser path deterministically.
vi.mock("../services/importApi", () => ({
  isBackendAvailable: vi.fn().mockResolvedValue(false),
  previewImport: vi.fn(),
  commitImport: vi.fn(),
}));

import { ImportPage } from "../pages/ImportPage";

function file(name: string, content: string): File {
  return new File([content], name, { type: "application/json" });
}

beforeEach(() => {
  toast.success.mockClear();
});

describe("ImportPage", () => {
  it("renders the upload step with a browse action and the stepper", () => {
    render(<ImportPage onNavigate={vi.fn()} />);
    expect(screen.getByText("Import Emails")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Browse files/ })).toBeInTheDocument();
    expect(screen.getByText("Upload")).toBeInTheDocument();
    expect(screen.getByText("Review")).toBeInTheDocument();
  });

  it("rejects an unsupported file type", async () => {
    render(<ImportPage onNavigate={vi.fn()} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file("notes.txt", "hello")] } });
    await waitFor(() =>
      expect(screen.getByText(/Unsupported file type/)).toBeInTheDocument(),
    );
  });

  it("parses a valid JSON file locally and shows the preview", async () => {
    render(<ImportPage onNavigate={vi.fn()} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const json = JSON.stringify([
      {
        company: "Acme Cloud",
        jobTitle: "Software Engineer",
        from: "careers@acmecloud.com",
        subject: "Thanks for applying",
        emailDate: "2026-10-15T08:45:00Z",
        body: "We received your application.",
      },
    ]);
    fireEvent.change(input, { target: { files: [file("emails.json", json)] } });
    await waitFor(() => expect(screen.getByText("Parsed")).toBeInTheDocument());
    // Confirm button appears with the count.
    expect(
      screen.getByRole("button", { name: /Import 1 application/ }),
    ).toBeInTheDocument();
  });
});
