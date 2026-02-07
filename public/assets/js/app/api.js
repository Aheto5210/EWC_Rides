const API_BASE = "__API_BASE_URL__";

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
