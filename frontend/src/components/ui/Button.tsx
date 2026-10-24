import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: "md" | "sm";
  icon?: ReactNode;
  children?: ReactNode;
}

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  children,
  className = "",
  ...rest
}: ButtonProps) {
  const variantClass =
    variant === "primary"
      ? "primary"
      : variant === "danger"
        ? "danger"
        : variant === "ghost"
          ? "ghost"
          : "";
  return (
    <button
      className={`btn ${variantClass} ${size === "sm" ? "sm" : ""} ${className}`}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string; // accessible name (required)
  bordered?: boolean;
  children: ReactNode;
}

export function IconButton({
  label,
  bordered,
  children,
  className = "",
  ...rest
}: IconButtonProps) {
  return (
    <button
      className={`icon-btn ${bordered ? "bordered" : ""} ${className}`}
      aria-label={label}
      title={label}
      {...rest}
    >
      {children}
    </button>
  );
}
