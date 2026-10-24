/** Minimal hash router with query-param support (no external dependency). */
import { useEffect, useState } from "react";

export type Route =
  | "overview"
  | "applications"
  | "import"
  | "reminders"
  | "settings";

export const ROUTES: Route[] = [
  "overview",
  "applications",
  "import",
  "reminders",
  "settings",
];

export interface RouteState {
  route: Route;
  params: URLSearchParams;
}

function parse(): RouteState {
  const raw = window.location.hash.replace(/^#\/?/, "");
  const [path, qs = ""] = raw.split("?");
  const route = (ROUTES as string[]).includes(path)
    ? (path as Route)
    : "overview";
  return { route, params: new URLSearchParams(qs) };
}

export function useRoute(): [
  RouteState,
  (r: Route, params?: Record<string, string>) => void,
] {
  const [state, setState] = useState<RouteState>(parse());

  useEffect(() => {
    const onChange = () => setState(parse());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  const navigate = (r: Route, params?: Record<string, string>) => {
    const qs = params ? new URLSearchParams(params).toString() : "";
    window.location.hash = `/${r}${qs ? `?${qs}` : ""}`;
  };

  return [state, navigate];
}
