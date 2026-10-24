/** Client for the stateful follow-up reminder endpoints. */
import type { DraftResponse, GroupedReminders, ReminderRecord } from "../types";
import { authHeaders } from "./authToken";

const BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

async function detail(res: Response): Promise<string> {
  try {
    const d = await res.json();
    if (typeof d?.detail === "string") return d.detail;
  } catch {
    /* ignore */
  }
  return `Request failed (${res.status})`;
}

export async function fetchGroupedReminders(): Promise<GroupedReminders> {
  const res = await fetch(`${BASE}/api/reminders`, {
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(await detail(res));
  return (await res.json()) as GroupedReminders;
}

export async function recalculateReminders(): Promise<{
  created: number;
  updated: number;
  obsoleted: number;
  total_active: number;
}> {
  const res = await fetch(`${BASE}/api/reminders/recalculate`, {
    method: "POST",
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(await detail(res));
  return await res.json();
}

export async function dismissReminder(id: string): Promise<ReminderRecord> {
  const res = await fetch(`${BASE}/api/reminders/${id}/dismiss`, {
    method: "POST",
    headers: await authHeaders(),
  });
  if (!res.ok) throw new Error(await detail(res));
  return (await res.json()) as ReminderRecord;
}

export async function draftFollowup(args: {
  reminder_id?: string;
  application_id?: string;
}): Promise<DraftResponse> {
  const res = await fetch(`${BASE}/api/reminders/draft`, {
    method: "POST",
    headers: await authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(await detail(res));
  return (await res.json()) as DraftResponse;
}
