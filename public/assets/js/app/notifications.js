export function createNotifications({ state, els } = {}) {
  const shownByTag = new Map(); // tag -> element

  // Keep this for API compatibility; we no longer prompt for OS notification permission.
  async function ensureNotificationPermission() {
    return false;
  }

  function removeToast(el) {
    if (!el) return;
    el.classList.add("toast--leaving");
    const tag = el.getAttribute("data-tag") || "";
    if (tag) shownByTag.delete(tag);
    setTimeout(() => {
      try {
        el.remove();
      } catch {
        // ignore
      }
    }, 160);
  }

  function showToast({ title, body, tone = "info", tag = "", durationMs = 4500 } = {}) {
    if (!els?.toasts) return;
    const safeTitle = String(title ?? "").trim() || "Update";
    const safeBody = String(body ?? "").trim();
    const safeTone = ["success", "warning", "danger", "info"].includes(tone) ? tone : "info";
    const safeTag = tag ? String(tag) : "";

    if (safeTag && shownByTag.has(safeTag)) {
      const existing = shownByTag.get(safeTag);
      if (existing) removeToast(existing);
    }

    const el = document.createElement("div");
    el.className = `toast toast--${safeTone}`;
    if (safeTag) el.setAttribute("data-tag", safeTag);
    el.innerHTML = `
      <div class="toast__dot" aria-hidden="true"></div>
      <div class="toast__content">
        <div class="toast__title">${escapeHtml(safeTitle)}</div>
        ${safeBody ? `<div class="toast__body">${escapeHtml(safeBody)}</div>` : ""}
      </div>
      <button class="toast__close" type="button" aria-label="Dismiss">✕</button>
    `;

    const btn = el.querySelector(".toast__close");
    btn?.addEventListener("click", () => removeToast(el));
    el.addEventListener("click", (e) => {
      const target = e.target;
      if (target && target.closest && target.closest(".toast__close")) return;
      removeToast(el);
    });

    els.toasts.appendChild(el);
    if (safeTag) shownByTag.set(safeTag, el);

    if (durationMs > 0) {
      setTimeout(() => removeToast(el), durationMs);
    }
  }

  async function showDriverNotification({ title, body, tag }) {
    if (state.role !== "driver") return;
    showToast({
      title: title || "New request",
      body,
      tag,
      tone: "warning",
      durationMs: 7000,
    });
  }

  return { ensureNotificationPermission, showDriverNotification, showToast };
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
