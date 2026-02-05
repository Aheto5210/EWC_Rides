import { STORAGE_KEYS } from "./constants.js";
import { digitsOnly, formatPhoneDigits, isValidPhoneDigits } from "./utils.js";

export function createSheet(state, els) {
  function setSheetError(msg) {
    els.sheetError.hidden = !msg;
    els.sheetError.textContent = msg || "";
  }

  function openSheet({ title, body, confirmText }) {
    els.sheetTitle.textContent = title || "";
    els.sheetBody.innerHTML = "";
    if (body) els.sheetBody.appendChild(body);
    els.sheetConfirm.textContent = confirmText || "Continue";
    els.sheetConfirm.disabled = false;
    setSheetError("");

    state.sheet.open = true;
    els.sheet.hidden = false;
    document.documentElement.style.overflow = "hidden";

    queueMicrotask(() => {
      const first =
        els.sheetBody.querySelector("input, button, textarea, select") || els.sheetConfirm;
      if (first && typeof first.focus === "function") first.focus();
    });
  }

  function closeSheet() {
    const onClose = state.sheet.onClose;
    state.sheet.open = false;
    state.sheet.onConfirm = null;
    state.sheet.onClose = null;
    els.sheet.hidden = true;
    setSheetError("");
    document.documentElement.style.overflow = "";
    if (typeof onClose === "function") {
      try {
        onClose();
      } catch {
        // ignore
      }
    }
  }

  function promptRiderContact() {
    return new Promise((resolve) => {
      const body = document.createElement("div");
      const savedName = (localStorage.getItem(STORAGE_KEYS.riderName) ?? "").trim();
      const savedPhone = (localStorage.getItem(STORAGE_KEYS.riderPhone) ?? "").trim();

      body.innerHTML = `
        <div class="muted">This info will be shared with the driver you request.</div>
        <label class="field">
          <span class="field__label">Your name</span>
          <input id="sheetRiderName" class="input" autocomplete="name" placeholder="e.g., Isaac" />
        </label>
        <label class="field">
          <span class="field__label">Your phone</span>
          <input id="sheetRiderPhone" class="input" inputmode="tel" autocomplete="tel" placeholder="e.g., 4045551234" />
        </label>
      `;

      openSheet({ title: "Request a ride", body, confirmText: "Request" });

      const nameInput = body.querySelector("#sheetRiderName");
      const phoneInput = body.querySelector("#sheetRiderPhone");
      if (nameInput) nameInput.value = savedName;
      if (phoneInput) phoneInput.value = formatPhoneDigits(savedPhone);

      state.sheet.onClose = () => resolve(null);
      state.sheet.onConfirm = async () => {
        const name = (nameInput?.value ?? "").trim();
        const phoneDigits = digitsOnly(phoneInput?.value ?? "");

        if (!name) {
          setSheetError("Please enter your name.");
          nameInput?.focus();
          return;
        }
        if (!isValidPhoneDigits(phoneDigits)) {
          setSheetError("Please enter a valid phone number.");
          phoneInput?.focus();
          return;
        }

        localStorage.setItem(STORAGE_KEYS.riderName, name);
        localStorage.setItem(STORAGE_KEYS.riderPhone, phoneDigits);

        state.sheet.onClose = null;
        resolve({ name, phone: phoneDigits });
        closeSheet();
      };
    });
  }

  function promptDriverContact(title = "Driver details", confirmText = "Save") {
    return new Promise((resolve) => {
      const body = document.createElement("div");
      const savedName = (localStorage.getItem(STORAGE_KEYS.driverName) ?? "").trim();
      const savedPhone = (localStorage.getItem(STORAGE_KEYS.driverPhone) ?? "").trim();

      body.innerHTML = `
        <div class="muted">Share your contact so the rider can reach you.</div>
        <label class="field">
          <span class="field__label">First name</span>
          <input id="sheetDriverName" class="input" autocomplete="given-name" placeholder="e.g., John" />
        </label>
        <label class="field">
          <span class="field__label">Phone</span>
          <input id="sheetDriverPhone" class="input" inputmode="tel" autocomplete="tel" placeholder="e.g., 4045551234" />
        </label>
      `;

      openSheet({ title, body, confirmText });

      const nameInput = body.querySelector("#sheetDriverName");
      const phoneInput = body.querySelector("#sheetDriverPhone");
      if (nameInput) nameInput.value = savedName;
      if (phoneInput) phoneInput.value = formatPhoneDigits(savedPhone);

      state.sheet.onClose = () => resolve(null);
      state.sheet.onConfirm = async () => {
        const name = (nameInput?.value ?? "").trim();
        const phoneDigits = digitsOnly(phoneInput?.value ?? "");

        if (!name) {
          setSheetError("Please enter your first name.");
          nameInput?.focus();
          return;
        }
        if (!isValidPhoneDigits(phoneDigits)) {
          setSheetError("Please enter a valid phone number.");
          phoneInput?.focus();
          return;
        }

        localStorage.setItem(STORAGE_KEYS.driverName, name);
        localStorage.setItem(STORAGE_KEYS.driverPhone, phoneDigits);

        state.sheet.onClose = null;
        resolve({ name, phone: phoneDigits });
        closeSheet();
      };
    });
  }

  function promptDriverRegister() {
    return new Promise((resolve) => {
      const body = document.createElement("div");

      body.innerHTML = `
        <div class="muted">Register once. Your 4-digit code is your phone’s last 4 digits.</div>
        <label class="field">
          <span class="field__label">First name</span>
          <input id="sheetRegName" class="input" autocomplete="given-name" placeholder="e.g., John" />
        </label>
        <label class="field">
          <span class="field__label">Phone</span>
          <input id="sheetRegPhone" class="input" inputmode="tel" autocomplete="tel" placeholder="e.g., 4045551234" />
        </label>
      `;

      openSheet({ title: "Register as a driver", body, confirmText: "Register" });

      const nameInput = body.querySelector("#sheetRegName");
      const phoneInput = body.querySelector("#sheetRegPhone");

      state.sheet.onClose = () => resolve(null);
      state.sheet.onConfirm = async () => {
        const name = (nameInput?.value ?? "").trim();
        const phoneDigits = digitsOnly(phoneInput?.value ?? "");

        if (!name) {
          setSheetError("Please enter your first name.");
          nameInput?.focus();
          return;
        }
        if (!isValidPhoneDigits(phoneDigits)) {
          setSheetError("Please enter a valid phone number.");
          phoneInput?.focus();
          return;
        }

        state.sheet.onClose = null;
        resolve({ name, phone: phoneDigits });
        closeSheet();
      };
    });
  }

  function promptDriverCode() {
    return new Promise((resolve) => {
      const body = document.createElement("div");

      body.innerHTML = `
        <div class="muted">Enter your 4-digit driver code to continue.</div>
        <label class="field">
          <span class="field__label">4-digit code</span>
          <input id="sheetLoginCode" class="input" inputmode="numeric" autocomplete="one-time-code" placeholder="e.g., 1234" maxlength="4" />
        </label>
      `;

      openSheet({ title: "Driver access", body, confirmText: "Continue" });

      const codeInput = body.querySelector("#sheetLoginCode");

      state.sheet.onClose = () => resolve(null);
      state.sheet.onConfirm = async () => {
        const codeDigits = digitsOnly(codeInput?.value ?? "").slice(0, 4);

        if (codeDigits.length !== 4) {
          setSheetError("Enter your 4-digit code.");
          codeInput?.focus();
          return;
        }

        state.sheet.onClose = null;
        resolve({ code: codeDigits });
        closeSheet();
      };
    });
  }

  function showDriverCode(code) {
    return new Promise((resolve) => {
      const body = document.createElement("div");
      body.innerHTML = `
        <div class="notice" style="margin: 0;">
          <div style="font-weight: 850; letter-spacing: 0.4px;">Your driver code</div>
          <div style="font-size: 34px; font-weight: 900; letter-spacing: 3px; margin-top: 6px;">${code}</div>
          <div class="muted" style="margin-top: 8px;">Use this code when you tap “I’m a Driver”.</div>
        </div>
      `;

      openSheet({ title: "Registered", body, confirmText: "Done" });
      state.sheet.onClose = () => resolve(false);
      state.sheet.onConfirm = async () => {
        state.sheet.onClose = null;
        resolve(true);
        closeSheet();
      };
    });
  }

  function promptDriverPick(choices) {
    return new Promise((resolve) => {
      const body = document.createElement("div");
      body.innerHTML = `
        <div class="muted">Multiple drivers match this code. Pick your name.</div>
        <div class="list" style="margin-top: 6px;"></div>
      `;
      const list = body.querySelector(".list");
      for (let i = 0; i < (choices || []).length; i += 1) {
        const c = choices[i];
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn btn--block";
        btn.textContent = c?.name ? String(c.name) : `Driver ${i + 1}`;
        btn.addEventListener("click", () => {
          state.sheet.onClose = null;
          resolve(i);
          closeSheet();
        });
        list?.appendChild(btn);
      }

      openSheet({ title: "Choose driver", body, confirmText: "Cancel" });
      state.sheet.onClose = () => resolve(null);
      state.sheet.onConfirm = async () => {
        resolve(null);
        closeSheet();
      };
    });
  }

  return {
    openSheet,
    closeSheet,
    setSheetError,
    promptRiderContact,
    promptDriverContact,
    promptDriverRegister,
    promptDriverCode,
    showDriverCode,
    promptDriverPick,
  };
}
