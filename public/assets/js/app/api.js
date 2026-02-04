export async function api(path, { method = "GET", body } = {}) {
  const headers = { "content-type": "application/json" };
  const res = await fetch(path, {
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

