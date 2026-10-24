import type { ReactNode } from "react";

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        <h1 className="ph-title">{title}</h1>
        {subtitle && <div className="ph-sub">{subtitle}</div>}
      </div>
      {actions && <div className="ph-actions">{actions}</div>}
    </div>
  );
}

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`panel ${className}`}>{children}</div>;
}

export function PanelHead({
  title,
  sub,
  action,
}: {
  title: string;
  sub?: string;
  action?: ReactNode;
}) {
  return (
    <div className="panel-head">
      <div className="inline" style={{ gap: 8 }}>
        <h2>{title}</h2>
        {sub && <span className="panel-sub">{sub}</span>}
      </div>
      {action}
    </div>
  );
}
