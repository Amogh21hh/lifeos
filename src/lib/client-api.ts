"use client";

/** Browser fetch wrapper: attaches the CSRF token, parses JSON, surfaces API errors as exceptions. */
export class ApiClientError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

function csrfToken(): string {
  if (typeof document === "undefined") return "";
  const m = document.cookie.match(/(?:^|;\s*)lifeos_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

export async function apiFetch<T = unknown>(url: string, init: { method?: string; body?: unknown; form?: FormData; signal?: AbortSignal } = {}): Promise<T> {
  const headers: Record<string, string> = { "x-csrf-token": csrfToken() };
  let body: BodyInit | undefined;
  if (init.form) body = init.form;
  else if (init.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(init.body);
  }
  const res = await fetch(url, { method: init.method ?? (body ? "POST" : "GET"), headers, body, signal: init.signal, credentials: "same-origin" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined" && !url.startsWith("/api/auth")) window.location.href = "/login";
    throw new ApiClientError(res.status, (data as { error?: string }).error ?? `Request failed (${res.status})`, (data as { code?: string }).code);
  }
  return data as T;
}
