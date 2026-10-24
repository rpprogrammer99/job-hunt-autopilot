import type { ReactNode } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight } from "lucide-react";

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="spinner-wrap" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      {label && <span>{label}</span>}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  message,
  action,
}: {
  icon?: ReactNode;
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="state-block">
      {icon && (
        <div className="state-icon" aria-hidden="true">
          {icon}
        </div>
      )}
      <h3>{title}</h3>
      <p>{message}</p>
      {action && <div className="state-actions">{action}</div>}
    </div>
  );
}

export function ErrorBanner({
  message,
  onRetry,
  onDismiss,
}: {
  message: string;
  onRetry?: () => void;
  onDismiss?: () => void;
}) {
  return (
    <div className="error-banner" role="alert">
      <AlertTriangle size={18} aria-hidden="true" />
      <span>{message}</span>
      {onRetry && (
        <button className="link-btn" onClick={onRetry}>
          Retry
        </button>
      )}
      {onDismiss && (
        <button className="link-btn" onClick={onDismiss}>
          Dismiss
        </button>
      )}
    </div>
  );
}

export function SkeletonTable({ rows = 6 }: { rows?: number }) {
  return (
    <div className="table-wrap" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="skeleton-row"
          style={{ display: "flex", alignItems: "center", padding: "0 16px", gap: 16 }}
        >
          <span className="skeleton" style={{ height: 14, width: "22%" }} />
          <span className="skeleton" style={{ height: 14, width: "26%" }} />
          <span className="skeleton" style={{ height: 14, width: "14%" }} />
          <span className="skeleton" style={{ height: 14, width: "16%" }} />
        </div>
      ))}
    </div>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);
  return (
    <div className="pagination">
      <span>
        {start}–{end} of {total}
      </span>
      <div className="pagination-controls">
        <button
          className="icon-btn bordered"
          aria-label="Previous page"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          <ChevronLeft size={16} />
        </button>
        <span className="base">
          Page {page} / {pages}
        </span>
        <button
          className="icon-btn bordered"
          aria-label="Next page"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
