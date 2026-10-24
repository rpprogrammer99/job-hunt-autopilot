import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  RefreshCw,
  FileText,
  Copy,
  X as XIcon,
  Clock,
  CalendarClock,
  CalendarCheck,
} from "lucide-react";
import { useData } from "../context/DataContext";
import { isBackendAvailable } from "../services/importApi";
import {
  dismissReminder,
  draftFollowup,
  fetchGroupedReminders,
  recalculateReminders,
} from "../services/remindersApi";
import { daysUntil, formatDate } from "../lib/helpers";
import {
  PageHeader,
  Card,
  PanelHead,
  Button,
  Dialog,
  Spinner,
  EmptyState,
  ErrorBanner,
  useToast,
} from "../components/ui";
import type { DraftResponse, GroupedReminders, ReminderRecord } from "../types";
import type { Route } from "../lib/router";

const EMPTY: GroupedReminders = { overdue: [], due_today: [], upcoming: [], dismissed: [] };

export function RemindersPage({ onNavigate }: { onNavigate: (r: Route) => void }) {
  const { applications } = useData();
  const toast = useToast();
  const [groups, setGroups] = useState<GroupedReminders>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [recalculating, setRecalculating] = useState(false);
  const [backendUp, setBackendUp] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ reminder: ReminderRecord; draft: DraftResponse } | null>(null);
  const [drafting, setDrafting] = useState<string | null>(null);

  const localGroups = useCallback((): GroupedReminders => {
    const g: GroupedReminders = { overdue: [], due_today: [], upcoming: [], dismissed: [] };
    for (const a of applications) {
      if (!a.nextFollowUp || a.status === "offer" || a.status === "rejected") continue;
      const n = daysUntil(a.nextFollowUp);
      const rec: ReminderRecord = {
        id: `local-${a.id}`,
        user_id: "local",
        application_id: a.id,
        company: a.company,
        role: a.jobTitle,
        base_date: a.lastUpdated,
        due_date: a.nextFollowUp,
        reason: n !== null && n <= 0 ? "Follow-up is due." : `Follow-up in ${n} day${n === 1 ? "" : "s"}.`,
        status: n === null ? "upcoming" : n < 0 ? "overdue" : n === 0 ? "due_today" : "upcoming",
        suggested_action: `Send a short, polite follow-up to ${a.company}.`,
        cycle_key: "",
        created_at: null,
        updated_at: null,
      };
      if (rec.status === "overdue") g.overdue.push(rec);
      else if (rec.status === "due_today") g.due_today.push(rec);
      else g.upcoming.push(rec);
    }
    return g;
  }, [applications]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const online = await isBackendAvailable();
    setBackendUp(online);
    if (online) {
      try {
        setGroups(await fetchGroupedReminders());
      } catch (e) {
        setError((e as Error).message);
      }
    } else {
      setGroups(localGroups());
    }
    setLoading(false);
  }, [localGroups]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleDismiss(r: ReminderRecord) {
    if (!backendUp) return;
    try {
      await dismissReminder(r.id);
      toast.success("Reminder dismissed.");
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function handleDraft(r: ReminderRecord) {
    setDrafting(r.id);
    setError(null);
    try {
      const d = backendUp
        ? await draftFollowup({ reminder_id: r.id })
        : await draftFollowup({ application_id: r.application_id });
      setDraft({ reminder: r, draft: d });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDrafting(null);
    }
  }

  async function handleRecalculate() {
    setRecalculating(true);
    setError(null);
    try {
      if (backendUp) await recalculateReminders();
      await load();
      toast.info("Reminders recalculated.");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRecalculating(false);
    }
  }

  function copyDraft() {
    if (!draft) return;
    void navigator.clipboard
      ?.writeText(`Subject: ${draft.draft.subject}\n\n${draft.draft.body}`)
      .then(() => toast.success("Draft copied to clipboard."));
  }

  if (loading) return <Spinner label="Checking follow-ups…" />;

  const totalActive = groups.overdue.length + groups.due_today.length + groups.upcoming.length;

  function group(
    title: string,
    icon: React.ReactNode,
    items: ReminderRecord[],
    accent: "overdue" | "due" | "",
    emptyText: string,
  ) {
    return (
      <Card>
        <PanelHead
          title={title}
          action={<span className="count-badge">{items.length}</span>}
        />
        {items.length === 0 ? (
          <p className="muted base" style={{ margin: 0 }}>{emptyText}</p>
        ) : (
          <ul className="row-list">
            {items.map((r) => (
              <li
                key={r.id}
                className={accent ? `reminder-item ${accent}` : "row-item"}
              >
                <div className="row-main">
                  <div className="row-title inline" style={{ gap: 6 }}>
                    {icon}
                    {r.company} — {r.role}
                  </div>
                  <div className="row-sub">{r.reason}</div>
                  <div className="row-sub">
                    Due {formatDate(r.due_date)}
                    {r.suggested_action ? ` · ${r.suggested_action}` : ""}
                  </div>
                </div>
                <div className="row-meta">
                  <Button
                    size="sm"
                    icon={<FileText size={14} />}
                    disabled={drafting === r.id}
                    onClick={() => void handleDraft(r)}
                  >
                    {drafting === r.id ? "Drafting…" : "Draft"}
                  </Button>
                  {backendUp && (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<XIcon size={14} />}
                      onClick={() => void handleDismiss(r)}
                    >
                      Dismiss
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    );
  }

  return (
    <div className="page">
      <PageHeader
        title="Reminders"
        subtitle="Follow-ups are suggested 7 days after your last interaction"
        actions={
          <Button
            icon={<RefreshCw size={15} />}
            disabled={recalculating}
            onClick={() => void handleRecalculate()}
          >
            {recalculating ? "Recalculating…" : "Recalculate"}
          </Button>
        }
      />

      {backendUp === false && (
        <div className="info-note warning">
          The backend is offline — showing a local estimate. Dismissing requires
          the backend.
        </div>
      )}

      {error && <ErrorBanner message={error} onRetry={() => void load()} onDismiss={() => setError(null)} />}

      {totalActive === 0 ? (
        <EmptyState
          icon={<CheckCircle2 size={22} />}
          title="You're all caught up"
          message="No applications need a follow-up right now."
          action={
            <Button onClick={() => onNavigate("applications")}>View applications</Button>
          }
        />
      ) : (
        <>
          {group("Overdue", <Clock size={14} />, groups.overdue, "overdue", "Nothing overdue.")}
          {group("Due today", <CalendarClock size={14} />, groups.due_today, "due", "Nothing due today.")}
          {group("Upcoming", <CalendarCheck size={14} />, groups.upcoming, "", "Nothing upcoming.")}
        </>
      )}

      <Dialog
        open={draft !== null}
        title={draft ? `Draft follow-up · ${draft.reminder.company}` : "Draft"}
        onClose={() => setDraft(null)}
        footer={
          <>
            <Button variant="primary" icon={<Copy size={15} />} onClick={copyDraft}>
              Copy to clipboard
            </Button>
            <Button onClick={() => setDraft(null)}>Close</Button>
          </>
        }
      >
        {draft && (
          <div className="stack" style={{ gap: 12 }}>
            {draft.draft.source === "fallback-template" && (
              <div className="info-note warning">
                Generated from a safe template (Gemini not connected). It invents
                no outcomes, promises, or dates.
              </div>
            )}
            <div className="field">
              <span className="form-label">Subject</span>
              <input className="input" readOnly value={draft.draft.subject} />
            </div>
            <div className="field">
              <span className="form-label">Message</span>
              <textarea className="textarea" readOnly rows={9} value={draft.draft.body} />
            </div>
            <p className="muted small" style={{ margin: 0 }}>{draft.draft.disclaimer}</p>
          </div>
        )}
      </Dialog>
    </div>
  );
}
