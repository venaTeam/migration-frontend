import type { BacktestResponse, EvaluateResponse, StandardSchema } from "../types";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "";

/** Called when any API request answers 401: the app drops to the login
 * view. App registers this so client.ts stays framework-free. */
let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...options.headers,
      },
    });
    if (response.status === 401 && path !== "/api/auth/login" && onUnauthorized) {
      onUnauthorized();
    }
    return response;
  } catch (err) {
    throw err;
  }
}

export async function login(username: string, password: string): Promise<void> {
  const response = await apiFetch("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({
      grafana_username: username,
      grafana_password: password,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: "Login failed" }));
    throw new Error(error.message || "Login failed");
  }
}

export async function logout(): Promise<void> {
  await apiFetch("/api/auth/logout", { method: "POST" });
}

export async function fetchStandardSchema(): Promise<StandardSchema> {
  const response = await apiFetch("/api/standard/schema");
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: "Failed to load schema" }));
    throw new Error(error.message || "Failed to load schema");
  }
  return response.json();
}

export async function fetchNotificationPolicies(prefix = "Appchi - "): Promise<string[]> {
  const response = await apiFetch(
    `/api/notification-policies?prefix=${encodeURIComponent(prefix)}`
  );
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: "Failed to load policies" }));
    throw new Error(error.message || "Failed to load policies");
  }
  const data = await response.json();
  return data.policies || [];
}

export async function loadRule(ruleUrl: string): Promise<EvaluateResponse> {
  const response = await apiFetch("/api/rules/load", {
    method: "POST",
    body: JSON.stringify({ rule_url: ruleUrl }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: "Failed to load rule" }));
    throw new Error(error.message || "Failed to load rule");
  }
  return response.json();
}

export interface FolderRuleSummary {
  uid: string;
  title: string;
  rule_url: string;
  /** True when the backend registry says this v1 rule was already migrated and its v2 copy exists. */
  migrated?: boolean;
}

export interface ClassifiedFolderRules {
  folder_uid: string;
  v1: FolderRuleSummary[];
  v2: FolderRuleSummary[];
}

export async function loadFolderClassified(folderUrl: string): Promise<ClassifiedFolderRules> {
  const response = await apiFetch("/api/rules/load-folder-classified", {
    method: "POST",
    body: JSON.stringify({ folder_url: folderUrl }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: "Failed to load folder" }));
    throw new Error(error.message || "Failed to load folder");
  }
  return response.json();
}

export async function deleteRuleView(uid: string): Promise<void> {
  const response = await apiFetch(`/api/rules/view/${encodeURIComponent(uid)}`, {
    method: "DELETE",
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: "Failed to delete rule" }));
    throw new Error(error.message || "Failed to delete rule");
  }
}

export async function updateRuleView(
  uid: string,
  payload: {
    title: string;
    labels: Record<string, string>;
    annotations: Record<string, string>;
    clearAnnotations?: string[];
    clearLabels?: string[];
  }
): Promise<{ status: string; updated: string; title: string; rule_url: string }> {
  const response = await apiFetch(`/api/rules/view/${encodeURIComponent(uid)}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: "Failed to update rule" }));
    throw new Error(error.message || "Failed to update rule");
  }
  return response.json();
}

export async function runBacktest(payload: {
  rule_query: string;
  threshold: number;
  condition: "gt" | "gte" | "lt" | "lte" | "eq" | "neq";
  for_duration_seconds?: number;
  window_hours?: number;
}): Promise<BacktestResponse> {
  const response = await apiFetch("/api/backtest", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: "Backtest failed" }));
    throw new Error(error.message || "Backtest failed");
  }
  return response.json();
}

export async function cloneRule(
  uid: string,
  labels: Record<string, string>,
  annotations: Record<string, string>,
  folderUrl?: string
): Promise<{ action: "created" | "updated"; rule_uid: string; rule_url: string; title: string }> {
  const body = folderUrl ? { labels, annotations, folder_url: folderUrl } : { labels, annotations };
  const response = await apiFetch(`/api/rules/${uid}/clone`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: "Clone failed" }));
    throw new Error(error.message || "Clone failed");
  }
  return response.json();
}

export async function cloneAndDeleteRule(
  uid: string,
  labels: Record<string, string>,
  annotations: Record<string, string>,
  folderUrl?: string
): Promise<{ action: "created" | "updated"; rule_uid: string; rule_url: string; title: string; original_deleted: boolean }> {
  const body = folderUrl ? { labels, annotations, folder_url: folderUrl } : { labels, annotations };
  const response = await apiFetch(`/api/rules/${uid}/clone-and-delete`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: "Clone and delete failed" }));
    throw new Error(error.message || "Clone and delete failed");
  }
  return response.json();
}

export async function createRule(
  folderUrl: string,
  title: string,
  labels: Record<string, string>,
  annotations: Record<string, string>
): Promise<{ status: string; action: string; rule_uid: string; rule_url: string; title: string }> {
  const response = await apiFetch("/api/rules/create", {
    method: "POST",
    body: JSON.stringify({ folder_url: folderUrl, title, labels, annotations }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: "Create rule failed" }));
    throw new Error(error.message || "Create rule failed");
  }
  return response.json();
}

