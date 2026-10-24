import { useMemo, useState } from "react";
import { DataProvider, useData } from "./context/DataContext";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ToastProvider } from "./components/ui";
import { useRoute, type Route } from "./lib/router";
import { isFollowUpDue } from "./lib/helpers";
import { Sidebar } from "./components/Sidebar";
import { Topbar } from "./components/Topbar";
import { ErrorBanner, Spinner } from "./components/ui";
import { OverviewPage } from "./pages/OverviewPage";
import { ApplicationsPage } from "./pages/ApplicationsPage";
import { ImportPage } from "./pages/ImportPage";
import { RemindersPage } from "./pages/RemindersPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SignInPage } from "./pages/SignInPage";
import type { ApplicationStatus } from "./types";

const PAGE_TITLES: Record<Route, string> = {
  overview: "Overview",
  applications: "Applications",
  import: "Import Emails",
  reminders: "Reminders",
  settings: "Settings",
};

function Shell() {
  const [{ route, params }, navigate] = useRoute();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [search, setSearch] = useState("");
  const { error, clearError, applications } = useData();
  const { demoMode } = useAuth();

  const reminderCount = useMemo(
    () => applications.filter(isFollowUpDue).length,
    [applications],
  );

  const showSearch = route === "applications";
  const statusParam = (params.get("status") as ApplicationStatus | "all" | null) ?? null;
  const riskParam = params.get("risk");

  return (
    <div className="layout">
      <Sidebar
        current={route}
        onNavigate={navigate}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        reminderCount={reminderCount}
        demoMode={demoMode}
      />
      <div className="main">
        <Topbar
          title={PAGE_TITLES[route]}
          search={search}
          onSearch={setSearch}
          onMenu={() => setSidebarOpen(true)}
          showSearch={showSearch}
        />
        <main className="content">
          {error && (
            <div style={{ marginBottom: 16 }}>
              <ErrorBanner message={error} onDismiss={clearError} />
            </div>
          )}

          {route === "overview" && <OverviewPage onNavigate={navigate} />}
          {route === "applications" && (
            <ApplicationsPage
              search={search}
              onNavigate={navigate}
              initialStatus={statusParam}
              initialRisk={riskParam}
            />
          )}
          {route === "import" && <ImportPage onNavigate={navigate} />}
          {route === "reminders" && <RemindersPage onNavigate={navigate} />}
          {route === "settings" && <SettingsPage />}
        </main>
      </div>
    </div>
  );
}

function Gate() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="signin-wrap">
        <Spinner label="Verifying your session…" />
      </div>
    );
  }
  if (!user) return <SignInPage />;
  return (
    <DataProvider>
      <Shell />
    </DataProvider>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </ToastProvider>
  );
}
