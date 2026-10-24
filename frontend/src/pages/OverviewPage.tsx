import { useMemo } from "react";
import {
  Briefcase,
  MessagesSquare,
  Trophy,
  BellRing,
  Upload,
  ArrowRight,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { useData } from "../context/DataContext";
import { Card, PageHeader, PanelHead, Button, Spinner, EmptyState } from "../components/ui";
import { StatusBadge } from "../components/ui";
import { buildPipeline, formatDate, isFollowUpDue, daysUntil } from "../lib/helpers";
import type { ApplicationStatus } from "../types";
import type { Route } from "../lib/router";

type Nav = (r: Route, params?: Record<string, string>) => void;

function Metric({
  label,
  value,
  icon,
  tone = "default",
  onClick,
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone?: "default" | "success" | "warning" | "danger";
  onClick?: () => void;
}) {
  return (
    <button
      className="metric-card"
      onClick={onClick}
      aria-label={`${label}: ${value}. View details`}
    >
      <div className="metric-top">
        <span className="metric-label">{label}</span>
        <span className={`metric-icon ${tone === "default" ? "" : tone}`}>{icon}</span>
      </div>
      <span className="metric-value">{value}</span>
    </button>
  );
}

export function OverviewPage({ onNavigate }: { onNavigate: Nav }) {
  const { applications, loading } = useData();

  const stats = useMemo(() => {
    const total = applications.length;
    const interviews = applications.filter((a) => a.status === "interview").length;
    const offers = applications.filter((a) => a.status === "offer").length;
    const followUps = applications.filter(isFollowUpDue).length;
    const suspicious = applications.filter((a) => a.scam.suspicious);
    const pipeline = buildPipeline(applications);
    const dueReminders = applications
      .filter(isFollowUpDue)
      .sort(
        (a, b) =>
          new Date(a.nextFollowUp!).getTime() - new Date(b.nextFollowUp!).getTime(),
      )
      .slice(0, 5);
    const recent = [...applications]
      .sort(
        (a, b) =>
          new Date(b.lastUpdated).getTime() - new Date(a.lastUpdated).getTime(),
      )
      .slice(0, 6);
    return { total, interviews, offers, followUps, suspicious, pipeline, dueReminders, recent };
  }, [applications]);

  if (loading) return <Spinner label="Loading your dashboard…" />;

  if (stats.total === 0) {
    return (
      <div className="page">
        <PageHeader title="Overview" subtitle="Your job search at a glance" />
        <EmptyState
          icon={<Briefcase size={22} />}
          title="No applications yet"
          message="Import your recruiting emails to start tracking applications, follow-ups, and risk warnings."
          action={
            <Button variant="primary" icon={<Upload size={16} />} onClick={() => onNavigate("import")}>
              Import emails
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        title="Overview"
        subtitle="Your job search at a glance"
        actions={
          <>
            <Button icon={<Upload size={16} />} onClick={() => onNavigate("import")}>
              Import
            </Button>
            <Button
              variant="primary"
              icon={<ListIcon />}
              onClick={() => onNavigate("applications")}
            >
              View applications
            </Button>
          </>
        }
      />

      {/* Metrics */}
      <div className="metric-grid">
        <Metric
          label="Total Applications"
          value={stats.total}
          icon={<Briefcase size={16} />}
          onClick={() => onNavigate("applications")}
        />
        <Metric
          label="Interviews"
          value={stats.interviews}
          icon={<MessagesSquare size={16} />}
          tone="success"
          onClick={() => onNavigate("applications", { status: "interview" })}
        />
        <Metric
          label="Offers"
          value={stats.offers}
          icon={<Trophy size={16} />}
          tone="success"
          onClick={() => onNavigate("applications", { status: "offer" })}
        />
        <Metric
          label="Follow-ups Due"
          value={stats.followUps}
          icon={<BellRing size={16} />}
          tone={stats.followUps > 0 ? "warning" : "default"}
          onClick={() => onNavigate("reminders")}
        />
      </div>

      <div className="dash-grid">
        {/* Left column */}
        <div className="stack">
          <Card>
            <PanelHead title="Pipeline" sub={`${stats.total} applications`} />
            <div className="pipeline" role="img" aria-label="Application status distribution">
              {stats.pipeline
                .filter((s) => s.count > 0)
                .map((s) => (
                  <span
                    key={s.status}
                    className="pipeline-seg"
                    style={{ width: `${s.pct}%`, background: s.color }}
                  />
                ))}
            </div>
            <div className="pipeline-legend">
              {stats.pipeline.map((s) => (
                <button
                  key={s.status}
                  className="legend-item"
                  onClick={() =>
                    onNavigate("applications", { status: s.status as ApplicationStatus })
                  }
                  style={{ border: "none", background: "none", cursor: "pointer" }}
                >
                  <span className="legend-swatch" style={{ background: s.color }} />
                  {s.label} <span className="legend-count">{s.count}</span>
                </button>
              ))}
            </div>
          </Card>

          <Card>
            <PanelHead
              title="Recent activity"
              action={
                <button className="link-btn" onClick={() => onNavigate("applications")}>
                  View all <ArrowRight size={14} />
                </button>
              }
            />
            <div className="table-scroll">
              <table className="data-table" style={{ minWidth: 520 }}>
                <thead>
                  <tr>
                    <th className="th-plain">Company</th>
                    <th className="th-plain">Role</th>
                    <th className="th-plain">Status</th>
                    <th className="th-plain">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.recent.map((a) => (
                    <tr
                      key={a.id}
                      className="clickable"
                      onClick={() => onNavigate("applications")}
                    >
                      <td className="cell-primary">{a.company}</td>
                      <td className="cell-muted">{a.jobTitle}</td>
                      <td><StatusBadge status={a.status} /></td>
                      <td className="cell-muted">{formatDate(a.lastUpdated)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        {/* Right column */}
        <div className="stack">
          <Card>
            <PanelHead
              title="Follow-ups due"
              action={<span className="count-badge">{stats.dueReminders.length}</span>}
            />
            {stats.dueReminders.length === 0 ? (
              <p className="muted base" style={{ margin: 0 }}>
                You're all caught up. No follow-ups are due.
              </p>
            ) : (
              <ul className="row-list">
                {stats.dueReminders.map((a) => {
                  const overdue = Math.abs(daysUntil(a.nextFollowUp) ?? 0);
                  return (
                    <li key={a.id} className="row-item">
                      <div className="row-main">
                        <div className="row-title">{a.company}</div>
                        <div className="row-sub">
                          {a.jobTitle} · due {formatDate(a.nextFollowUp)}
                          {overdue > 0 && ` (${overdue}d ago)`}
                        </div>
                      </div>
                      <StatusBadge status={a.status} />
                    </li>
                  );
                })}
              </ul>
            )}
            {stats.dueReminders.length > 0 && (
              <button
                className="link-btn"
                style={{ marginTop: 12 }}
                onClick={() => onNavigate("reminders")}
              >
                Go to reminders <ArrowRight size={14} />
              </button>
            )}
          </Card>

          <Card>
            <PanelHead title="Security insights" />
            {stats.suspicious.length === 0 ? (
              <div className="inline" style={{ color: "var(--success)" }}>
                <ShieldCheck size={18} />
                <span className="base" style={{ color: "var(--text-secondary)" }}>
                  No applications are currently flagged with warning signs.
                </span>
              </div>
            ) : (
              <>
                <div className="inline" style={{ color: "var(--danger)", marginBottom: 10 }}>
                  <ShieldAlert size={18} />
                  <span className="base" style={{ color: "var(--text-secondary)" }}>
                    {stats.suspicious.length} application
                    {stats.suspicious.length > 1 ? "s" : ""} flagged with potential
                    warning signs. A warning is not proof of fraud.
                  </span>
                </div>
                <ul className="row-list">
                  {stats.suspicious.slice(0, 3).map((a) => (
                    <li key={a.id} className="row-item">
                      <div className="row-main">
                        <div className="row-title">{a.company}</div>
                        <div className="row-sub">{a.jobTitle}</div>
                      </div>
                      <span className="risk-chip risk-high">Review</span>
                    </li>
                  ))}
                </ul>
                <button
                  className="link-btn"
                  style={{ marginTop: 12 }}
                  onClick={() => onNavigate("applications", { risk: "flagged" })}
                >
                  Review flagged <ArrowRight size={14} />
                </button>
              </>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function ListIcon() {
  return <MessagesSquare size={16} />;
}
