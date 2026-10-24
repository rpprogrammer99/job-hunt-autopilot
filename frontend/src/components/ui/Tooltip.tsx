import { useState, type ReactNode } from "react";

/** Lightweight tooltip shown on hover/focus. For richer labels; icon buttons
 * already carry aria-label/title, so this is supplemental. */
export function Tooltip({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const [show, setShow] = useState(false);
  return (
    <span
      className="tooltip-anchor"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onFocus={() => setShow(true)}
      onBlur={() => setShow(false)}
    >
      {children}
      {show && (
        <span className="tooltip-bubble" role="tooltip">
          {label}
        </span>
      )}
    </span>
  );
}
