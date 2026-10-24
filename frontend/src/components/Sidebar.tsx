import {
  LayoutDashboard,
  ListChecks,
  Upload,
  BellRing,
  Settings as SettingsIcon,
  Plane,
} from "lucide-react";
import type { Route } from "../lib/router";

interface NavItem {
  route: Route;
  label: string;
  Icon: typeof LayoutDashboard;
}

const NAV_ITEMS: NavItem[] = [
  { route: "overview", label: "Overview", Icon: LayoutDashboard },
  { route: "applications", label: "Applications", Icon: ListChecks },
  { route: "import", label: "Import Emails", Icon: Upload },
  { route: "reminders", label: "Reminders", Icon: BellRing },
  { route: "settings", label: "Settings", Icon: SettingsIcon },
];

export function Sidebar({
  current,
  onNavigate,
  open,
  onClose,
  reminderCount = 0,
  demoMode = false,
}: {
  current: Route;
  onNavigate: (r: Route) => void;
  open: boolean;
  onClose: () => void;
  reminderCount?: number;
  demoMode?: boolean;
}) {
  return (
    <>
      <div
        className={`sidebar-scrim ${open ? "show" : ""}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside className={`sidebar ${open ? "open" : ""}`} aria-label="Primary">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <Plane size={18} />
          </span>
          <div>
            <div className="brand-name">Job Hunt</div>
            <div className="brand-sub">Autopilot</div>
          </div>
        </div>

        <nav className="nav">
          {NAV_ITEMS.map(({ route, label, Icon }) => (
            <button
              key={route}
              className={`nav-item ${current === route ? "active" : ""}`}
              onClick={() => {
                onNavigate(route);
                onClose();
              }}
              aria-current={current === route ? "page" : undefined}
            >
              <span className="nav-icon">
                <Icon size={18} />
              </span>
              {label}
              {route === "reminders" && reminderCount > 0 && (
                <span className="nav-count" aria-label={`${reminderCount} due`}>
                  {reminderCount}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="sidebar-foot">
          {demoMode && (
            <span className="demo-chip">
              <span className="dot" aria-hidden="true" /> Demo data
            </span>
          )}
        </div>
      </aside>
    </>
  );
}
