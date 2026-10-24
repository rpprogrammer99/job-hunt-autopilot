import { useEffect, useMemo, useState } from "react";
import { Upload, ListChecks } from "lucide-react";
import { useData } from "../context/DataContext";
import {
  PageHeader,
  Button,
  EmptyState,
  SkeletonTable,
  Pagination,
  ConfirmDialog,
  useToast,
} from "../components/ui";
import { ApplicationsTable } from "../components/ApplicationsTable";
import { ApplicationDetails } from "../components/ApplicationDetails";
import { filterApplications, sortApplications } from "../lib/helpers";
import {
  APPLICATION_STATUSES,
  STATUS_LABELS,
  type Application,
  type ApplicationStatus,
  type SortField,
  type SortState,
} from "../types";
import type { Route } from "../lib/router";

type Nav = (r: Route, params?: Record<string, string>) => void;
type RiskFilter = "all" | "flagged" | "clear";
const PAGE_SIZE = 10;

export function ApplicationsPage({
  search,
  onNavigate,
  initialStatus,
  initialRisk,
}: {
  search: string;
  onNavigate: Nav;
  initialStatus?: ApplicationStatus | "all" | null;
  initialRisk?: string | null;
}) {
  const { applications, loading, error, changeStatus, deleteApplication, refresh } =
    useData();
  const toast = useToast();

  const [statusFilter, setStatusFilter] = useState<ApplicationStatus | "all">(
    initialStatus ?? "all",
  );
  const [riskFilter, setRiskFilter] = useState<RiskFilter>(
    initialRisk === "flagged" ? "flagged" : "all",
  );
  const [sort, setSort] = useState<SortState>({ field: "emailDate", direction: "desc" });
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Application | null>(null);
  const [toDelete, setToDelete] = useState<Application | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Sync when navigated with a filter param.
  useEffect(() => {
    if (initialStatus) setStatusFilter(initialStatus);
    if (initialRisk === "flagged") setRiskFilter("flagged");
  }, [initialStatus, initialRisk]);

  const visible = useMemo(() => {
    let list = filterApplications(applications, { search, status: statusFilter });
    if (riskFilter === "flagged") list = list.filter((a) => a.scam.suspicious);
    else if (riskFilter === "clear") list = list.filter((a) => !a.scam.suspicious);
    return sortApplications(list, sort);
  }, [applications, search, statusFilter, riskFilter, sort]);

  // Reset to page 1 when filters/search change.
  useEffect(() => setPage(1), [search, statusFilter, riskFilter, sort]);

  const pageItems = useMemo(
    () => visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [visible, page],
  );

  const selectedLive = selected
    ? applications.find((a) => a.id === selected.id) ?? null
    : null;

  function toggleSort(field: SortField) {
    setSort((s) =>
      s.field === field
        ? { field, direction: s.direction === "asc" ? "desc" : "asc" }
        : { field, direction: "asc" },
    );
  }

  async function handleStatusChange(id: string, status: ApplicationStatus) {
    try {
      await changeStatus(id, status);
      toast.success(`Status updated to ${STATUS_LABELS[status]}.`);
    } catch {
      toast.error("Could not update status.");
    }
  }

  async function confirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await deleteApplication(toDelete.id);
      toast.success(`Deleted ${toDelete.company}.`);
      if (selected?.id === toDelete.id) setSelected(null);
      setToDelete(null);
    } catch {
      toast.error("Could not delete the application.");
    } finally {
      setDeleting(false);
    }
  }

  const header = (
    <PageHeader
      title="Applications"
      subtitle={`${applications.length} tracked`}
      actions={
        <Button variant="primary" icon={<Upload size={16} />} onClick={() => onNavigate("import")}>
          Import emails
        </Button>
      }
    />
  );

  if (loading) {
    return (
      <div className="page">
        {header}
        <SkeletonTable rows={8} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="page">
        {header}
        <EmptyState
          icon={<ListChecks size={22} />}
          title="Couldn't load applications"
          message={error}
          action={<Button onClick={() => void refresh()}>Try again</Button>}
        />
      </div>
    );
  }

  return (
    <div className="page">
      {header}

      <div className="toolbar">
        <div className="filter-row" role="group" aria-label="Filter by status">
          <button
            className={`pill ${statusFilter === "all" ? "active" : ""}`}
            onClick={() => setStatusFilter("all")}
          >
            All <span className="pill-count">{applications.length}</span>
          </button>
          {APPLICATION_STATUSES.map((s) => {
            const count = applications.filter((a) => a.status === s).length;
            return (
              <button
                key={s}
                className={`pill ${statusFilter === s ? "active" : ""}`}
                onClick={() => setStatusFilter(s)}
              >
                {STATUS_LABELS[s]} <span className="pill-count">{count}</span>
              </button>
            );
          })}
        </div>
        <div className="filter-row" role="group" aria-label="Filter by risk">
          <button
            className={`pill ${riskFilter === "all" ? "active" : ""}`}
            onClick={() => setRiskFilter("all")}
          >
            Any risk
          </button>
          <button
            className={`pill ${riskFilter === "flagged" ? "active" : ""}`}
            onClick={() => setRiskFilter("flagged")}
          >
            Flagged
          </button>
        </div>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={<ListChecks size={22} />}
          title="No matching applications"
          message={
            search || statusFilter !== "all" || riskFilter !== "all"
              ? "Try clearing the search or filters."
              : "Import some emails to start tracking applications."
          }
          action={
            <Button variant="primary" icon={<Upload size={16} />} onClick={() => onNavigate("import")}>
              Import emails
            </Button>
          }
        />
      ) : (
        <div className="stack" style={{ gap: 0 }}>
          <ApplicationsTable
            applications={pageItems}
            sort={sort}
            onSort={toggleSort}
            onRowClick={setSelected}
            onStatusChange={handleStatusChange}
            onDelete={setToDelete}
            selectedId={selectedLive?.id ?? null}
          />
          {visible.length > PAGE_SIZE && (
            <div className="table-wrap" style={{ marginTop: -1, borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
              <Pagination
                page={page}
                pageSize={PAGE_SIZE}
                total={visible.length}
                onPage={setPage}
              />
            </div>
          )}
        </div>
      )}

      <ApplicationDetails
        application={selectedLive}
        onClose={() => setSelected(null)}
        onStatusChange={handleStatusChange}
      />

      <ConfirmDialog
        open={toDelete !== null}
        title="Delete application?"
        message={
          toDelete
            ? `This permanently removes "${toDelete.company} — ${toDelete.jobTitle}". This cannot be undone.`
            : ""
        }
        confirmLabel="Delete"
        danger
        busy={deleting}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}
