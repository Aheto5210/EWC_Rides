import { CALL_ICON_SVG } from "./constants.js";
import { digitsOnly, escapeHtml, telHref } from "./utils.js";

export function callButtonHtml(phoneDigits, label) {
  const digits = digitsOnly(phoneDigits);
  if (!digits) return "";
  const text = String(label ?? "Call").trim() || "Call";
  const safeLabel = escapeHtml(text);
  return `<a class="callBtn callBtn--online" href="${escapeHtml(
    telHref(digits),
  )}" aria-label="${safeLabel}" title="${safeLabel}">${CALL_ICON_SVG}<span class="callBtn__text">Call</span></a>`;
}

