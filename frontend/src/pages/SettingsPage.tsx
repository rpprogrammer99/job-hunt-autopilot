import { useEffect, useState } from "react";
import {
  UserCircle2,
  ShieldCheck,
  Sparkles,
  Database,
  BellRing,
  RotateCcw,
} from "lucide-react";
import { useData } from "../context/DataContext";
import { useAuth } from "../context/AuthContext";
import { isBackendAvailable } from "../services/importApi";
import {
  PageHeader,
  Card,
  PanelHead,
  Button,
  ConfirmDialog,
  useToast,
} from "../components/ui";

function StatusTag({ on, children }: { on: boolean; children: React.ReactNode }) {
  return <span className={`status-tag ${on ? "on" : "off"}`}>{children}</span>;
}

export function SettingsPage() {
  const { backendLabel, applications, resetToDemo } = useData();
  const { user, demoMode, firebaseReady } = useAuth();
  const toast = useToast();

  const [backendUp, setBackendUp] = useState<boolean | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    isBackendAvailable().then(setBackendUp);
  }, []);

  const imported = applications.filter((a) => a.source === "imported").length;
  const demo = applications.filter((a) => a.source === "demo").length;

  async function handleReset() {
    setResetting(true);
    try {
      await resetToDemo();
      toast.success("Demo data restored.");
      setConfirmReset(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="page">
      <PageHeader title="Settings" subtitle="Account, data, and service status" />

      {/* Profile & account */}
      <Card>
        <PanelHead title="Profile & account" />
        <div className="settings-row">
          <div className="inline" style={{ gap: 12 }}>
            <UserCircle2 size={22} className="muted" />
            <div>
              <div className="sr-label">{user?.name || user?.email || "User"}</div>
              <div className="sr-desc">{user?.email || "No email on file"}</div>
            </div>
          </div>
          <StatusTag on={!user?.isDemo}>
            {user?.isDemo ? "Demo identity" : "Signed in"}
          </StatusTag>
        </div>
      </Card>

      {/* Authentication */}
      <Card>
        <PanelHead title="Authentication" />
        <div className="settings-row">
          <div>
            <div className="sr-label inline" style={{ gap: 6 }}>
              <ShieldCheck size={16} /> Firebase Authentication
            </div>
            <div className="sr-desc">
              {demoMode
                ? "Demo mode is enabled — no real sign-in is used."
                : firebaseReady
                  ? "Google sign-in via Firebase Authentication is active."
                  : "Firebase is not configured. Set VITE_FIREBASE_* to enable sign-in."}
            </div>
          </div>
          <StatusTag on={!demoMode && firebaseReady}>
            {demoMode ? "Demo" : firebaseReady ? "Connected" : "Not configured"}
          </StatusTag>
        </div>
      </Card>

      {/* AI analysis */}
      <Card>
        <PanelHead title="AI analysis" />
        <div className="settings-row">
          <div>
            <div className="sr-label inline" style={{ gap: 6 }}>
              <Sparkles size={16} /> Gemini analysis
            </div>
            <div className="sr-desc">
              Analysis runs on demand from the application details panel. When
              the backend/Gemini is unavailable, results are clearly labeled
              "Unverified · rule-based fallback" — never presented as a real AI
              verdict.
            </div>
          </div>
          <StatusTag on={backendUp === true}>
            {backendUp === null ? "Checking…" : backendUp ? "Backend online" : "Backend offline"}
          </StatusTag>
        </div>
      </Card>

      {/* Reminders */}
      <Card>
        <PanelHead title="Reminder preferences" />
        <div className="settings-row">
          <div>
            <div className="sr-label inline" style={{ gap: 6 }}>
              <BellRing size={16} /> Seven-day follow-ups
            </div>
            <div className="sr-desc">
              A follow-up is suggested 7 days after your last meaningful
              interaction. Rejected and offered applications are never reminded.
              This rule is fixed in this version.
            </div>
          </div>
          <StatusTag on>Enabled</StatusTag>
        </div>
      </Card>

      {/* Data & privacy */}
      <Card>
        <PanelHead title="Data & privacy" />
        <div className="settings-row">
          <div>
            <div className="sr-label inline" style={{ gap: 6 }}>
              <Database size={16} /> Active data source
            </div>
            <div className="sr-desc">{backendLabel}</div>
          </div>
          <span className="muted base">
            {demo} demo · {imported} imported
          </span>
        </div>
        <div className="info-note">
          We never store passwords, OTPs, or unnecessary identity data from
          emails, and raw email bodies are not logged on the server.
        </div>
        {user?.isDemo && (
          <div className="row-actions" style={{ marginTop: 16 }}>
            <Button
              variant="danger"
              icon={<RotateCcw size={15} />}
              onClick={() => setConfirmReset(true)}
            >
              Reset demo data
            </Button>
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={confirmReset}
        title="Reset demo data?"
        message="This clears imported demo records and restores the bundled sample applications. It only affects demo mode."
        confirmLabel="Reset"
        danger
        busy={resetting}
        onConfirm={() => void handleReset()}
        onCancel={() => setConfirmReset(false)}
      />
    </div>
  );
}
