const RAW_API_BASE = "__API_BASE_URL__";

export const API_BASE = (() => {
  const raw = String(RAW_API_BASE || "").trim();
  // If the placeholder is not replaced at build time, fall back to same-origin API.
  if (!raw || raw.includes("__API_BASE_URL__")) return "";
  return raw.endsWith("/") ? raw.slice(0, -1) : raw;
})();

export async function api(path, { method = "GET", body, headers: extraHeaders } = {}) {
  const headers = { ...(extraHeaders || {}) };
  if (body) headers["content-type"] = headers["content-type"] || "application/json";
  const url = path.startsWith("http") ? path : `${API_BASE}${path}`;
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (data && data.error) || res.statusText;
    const e = new Error(err);
    e.status = res.status;
    e.data = data;
    throw e;
  }
  return data;
}
