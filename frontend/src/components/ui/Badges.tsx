import type { ApplicationStatus, DataSource } from "../../types";
import { STATUS_LABELS } from "../../types";

export function StatusBadge({ status }: { status: ApplicationStatus }) {
  return (
    <span className={`badge status-${status}`}>
      <span className="dot" aria-hidden="true" />
      {STATUS_LABELS[status]}
    </span>
  );
}

export function SourceBadge({ source }: { source: DataSource }) {
  return (
    <span
      className={`badge source-${source}`}
      title={
        source === "demo"
          ? "Sample data bundled with the prototype"
          : "Data you imported"
      }
    >
      {source === "demo" ? "Demo" : "Imported"}
    </span>
  );
}
