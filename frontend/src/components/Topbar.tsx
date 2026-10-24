import { Menu, Search, LogOut, UserCircle2 } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { DropdownMenu, MenuItem, MenuSeparator } from "./ui";

interface TopbarProps {
  title: string;
  search: string;
  onSearch: (value: string) => void;
  onMenu: () => void;
  showSearch?: boolean;
}

function initials(name: string, email: string): string {
  const src = (name || email || "?").trim();
  const parts = src.split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

export function Topbar({
  title,
  search,
  onSearch,
  onMenu,
  showSearch = true,
}: TopbarProps) {
  const { user, logout, demoMode } = useAuth();
  const name = user?.name || user?.email || "User";

  return (
    <header className="topbar">
      <button className="icon-btn menu-btn" onClick={onMenu} aria-label="Open menu">
        <Menu size={20} />
      </button>
      <h1 className="page-title">{title}</h1>

      {showSearch ? (
        <label className="search-field">
          <Search size={15} aria-hidden="true" />
          <span className="sr-only">Search applications</span>
          <input
            type="search"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search company, role, sender…"
          />
        </label>
      ) : (
        <div style={{ marginLeft: "auto" }} />
      )}

      <div className="topbar-actions">
        <DropdownMenu
          trigger={({ toggle }) => (
            <button
              className="inline"
              onClick={toggle}
              aria-label="Account menu"
              style={{
                border: "none",
                background: "transparent",
                gap: 8,
                padding: "4px 6px",
                borderRadius: 8,
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: "50%",
                  background: "var(--primary-soft)",
                  color: "var(--primary)",
                  display: "grid",
                  placeItems: "center",
                  fontWeight: 700,
                  fontSize: 12,
                }}
              >
                {initials(user?.name ?? "", user?.email ?? "")}
              </span>
              <span className="user-meta" style={{ textAlign: "left", lineHeight: 1.2 }}>
                <span style={{ display: "block", fontSize: 13, fontWeight: 600 }}>
                  {name}
                </span>
                <span style={{ display: "block", fontSize: 11, color: "var(--text-muted)" }}>
                  {user?.isDemo ? "Demo mode" : "Signed in"}
                </span>
              </span>
            </button>
          )}
        >
          {(close) => (
            <>
              <div className="menu-item" style={{ pointerEvents: "none" }}>
                <UserCircle2 size={16} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                  {user?.email || name}
                </span>
              </div>
              {!demoMode && (
                <>
                  <MenuSeparator />
                  <MenuItem
                    icon={<LogOut size={16} />}
                    danger
                    onClick={() => {
                      close();
                      void logout();
                    }}
                  >
                    Sign out
                  </MenuItem>
                </>
              )}
            </>
          )}
        </DropdownMenu>
      </div>
    </header>
  );
}
