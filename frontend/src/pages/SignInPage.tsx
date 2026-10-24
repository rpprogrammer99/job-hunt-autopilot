import { Plane, LogIn } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { Button, ErrorBanner, Spinner } from "../components/ui";

export function SignInPage() {
  const { signInWithGoogle, loading, error, clearError, firebaseReady } = useAuth();

  if (loading) return <Spinner label="Checking your session…" />;

  return (
    <div className="signin-wrap">
      <div className="signin-card">
        <span className="brand-mark" aria-hidden="true">
          <Plane size={22} />
        </span>
        <h1>Job Hunt Autopilot</h1>
        <p className="muted base" style={{ margin: 0 }}>
          Track applications, review AI analysis, and manage follow-up reminders.
          Your data is private to your account.
        </p>

        {error && (
          <div style={{ width: "100%" }}>
            <ErrorBanner message={error} onDismiss={clearError} />
          </div>
        )}

        <Button
          variant="primary"
          className="signin-btn"
          icon={<LogIn size={16} />}
          onClick={() => void signInWithGoogle()}
          disabled={!firebaseReady}
        >
          Sign in with Google
        </Button>

        {!firebaseReady && (
          <p className="muted small" style={{ margin: 0 }}>
            Firebase is not configured. Add <code>VITE_FIREBASE_*</code> to{" "}
            <code>frontend/.env.local</code>, or enable demo mode with{" "}
            <code>VITE_DEMO_MODE=true</code>.
          </p>
        )}
        <p className="muted small" style={{ margin: 0 }}>
          We never ask for passwords or codes from your emails.
        </p>
      </div>
    </div>
  );
}
