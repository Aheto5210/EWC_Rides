export function createNotifications({ state } = {}) {
  async function ensureNotificationPermission() {
    if (state.role !== "driver") return false;
    if (typeof Notification === "undefined") return false;
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") return false;
    try {
      const result = await Notification.requestPermission();
      return result === "granted";
    } catch {
      return false;
    }
  }

  async function showDriverNotification({ title, body, tag }) {
    if (state.role !== "driver") return;
    if (typeof Notification === "undefined") return;
    if (Notification.permission !== "granted") return;

    const options = {
      body: String(body ?? ""),
      tag: tag ? String(tag) : undefined,
      renotify: true,
      icon: "/assets/icon.svg",
      badge: "/assets/icon.svg",
    };

    try {
      const reg = await navigator.serviceWorker?.ready;
      if (reg?.showNotification) {
        await reg.showNotification(String(title ?? "EWC Rides"), options);
        return;
      }
    } catch {
      // ignore
    }

    try {
      const n = new Notification(String(title ?? "EWC Rides"), options);
      n.onclick = () => {
        try {
          window.focus();
        } catch {
          // ignore
        }
      };
    } catch {
      // ignore
    }
  }

  return { ensureNotificationPermission, showDriverNotification };
}

