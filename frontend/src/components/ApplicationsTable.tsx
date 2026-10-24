import { ArrowUp, ArrowDown, MoreHorizontal, Eye, Trash2, ShieldAlert } from "lucide-react";
import type {
  Application,
  ApplicationStatus,
  SortField,
  SortState,
} from "../types";
import { APPLICATION_STATUSES, STATUS_LABELS } from "../types";
import { formatDate } from "../lib/helpers";
import { SourceBadge, DropdownMenu, MenuItem, MenuSeparator } from "./ui";

interface Props {
  applications: Application[];
  sort: SortState;
  onSort: (field: SortField) => void;
  onRowClick: (app: Application) => void;
  onStatusChange: (id: string, status: ApplicationStatus) => void;
  onDelete: (app: Application) => void;
  selectedId?: string | null;
}

const COLUMNS: { field: SortField; label: string }[] = [
  { field: "company", label: "Company" },
  { field: "jobTitle", label: "Job Title" },
  { field: "emailDate", label: "Applied" },
  { field: "status", label: "Status" },
];

export function ApplicationsTable({
  applications,
  sort,
  onSort,
  onRowClick,
  onStatusChange,
  onDelete,
  selectedId,
}: Props) {
  return (
    <div className="table-wrap">
      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th key={c.field}>
                  <button className="th-btn sortable" onClick={() => onSort(c.field)}>
                    {c.label}
                    {sort.field === c.field && (
                      <span className="sort-ind">
                        {sort.direction === "asc" ? (
                          <ArrowUp size={13} />
                        ) : (
                          <ArrowDown size={13} />
                        )}
                      </span>
                    )}
                  </button>
                </th>
              ))}
              <th className="th-plain">Risk</th>
              <th className="th-plain">Follow-up</th>
              <th className="th-plain">Source</th>
              <th className="th-plain" style={{ width: 48 }}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {applications.map((a) => (
              <tr
                key={a.id}
                className={`clickable ${selectedId === a.id ? "selected" : ""}`}
                onClick={() => onRowClick(a)}
              >
                <td className="cell-primary">{a.company}</td>
                <td>{a.jobTitle}</td>
                <td className="cell-muted">{formatDate(a.emailDate)}</td>
                <td onClick={(e) => e.stopPropagation()}>
                  <select
                    className="select"
                    style={{ height: 30, width: "auto", fontSize: 12, fontWeight: 600 }}
                    value={a.status}
                    aria-label={`Status for ${a.company}`}
                    onChange={(e) => onStatusChange(a.id, e.target.value as ApplicationStatus)}
                  >
                    {APPLICATION_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  {a.scam.suspicious ? (
                    <span className="risk-chip risk-high" title={a.scam.reasons.join("; ")}>
                      <ShieldAlert size={12} /> Review
                    </span>
                  ) : (
                    <span className="risk-none base">—</span>
                  )}
                </td>
                <td className="cell-muted">{formatDate(a.nextFollowUp)}</td>
                <td>
                  <SourceBadge source={a.source} />
                </td>
                <td onClick={(e) => e.stopPropagation()}>
                  <DropdownMenu
                    trigger={({ toggle }) => (
                      <button
                        className="icon-btn"
                        aria-label={`Actions for ${a.company}`}
                        onClick={toggle}
                      >
                        <MoreHorizontal size={16} />
                      </button>
                    )}
                  >
                    {(close) => (
                      <>
                        <MenuItem
                          icon={<Eye size={15} />}
                          onClick={() => {
                            close();
                            onRowClick(a);
                          }}
                        >
                          View details
                        </MenuItem>
                        <MenuSeparator />
                        <MenuItem
                          icon={<Trash2 size={15} />}
                          danger
                          onClick={() => {
                            close();
                            onDelete(a);
                          }}
                        >
                          Delete
                        </MenuItem>
                      </>
                    )}
                  </DropdownMenu>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
