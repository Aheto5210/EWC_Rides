import { STORAGE_KEYS } from "./constants.js";
import { digitsOnly, formatPhoneDigits, isValidPhoneDigits, sanitizeDestinationText } from "./utils.js";

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
      const savedDestination = (localStorage.getItem(STORAGE_KEYS.riderDestination) ?? "").trim();

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
        <label class="field">
          <span class="field__label">Where are you going?</span>
          <input id="sheetRiderDestination" class="input" autocomplete="street-address" placeholder="e.g., Accra Mall" />
        </label>
      `;

      openSheet({ title: "Request a ride", body, confirmText: "Request" });

      const nameInput = body.querySelector("#sheetRiderName");
      const phoneInput = body.querySelector("#sheetRiderPhone");
      const destinationInput = body.querySelector("#sheetRiderDestination");
      if (nameInput) nameInput.value = savedName;
      if (phoneInput) phoneInput.value = formatPhoneDigits(savedPhone);
      if (destinationInput) destinationInput.value = savedDestination;

      state.sheet.onClose = () => resolve(null);
      state.sheet.onConfirm = async () => {
        const name = (nameInput?.value ?? "").trim();
        const phoneDigits = digitsOnly(phoneInput?.value ?? "");
        const destination = sanitizeDestinationText(destinationInput?.value ?? "");

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
        if (!destination) {
          setSheetError("Please enter where you are going.");
          destinationInput?.focus();
          return;
        }

        localStorage.setItem(STORAGE_KEYS.riderName, name);
        localStorage.setItem(STORAGE_KEYS.riderPhone, phoneDigits);
        localStorage.setItem(STORAGE_KEYS.riderDestination, destination);

        state.sheet.onClose = null;
        resolve({ name, phone: phoneDigits, destination });
        closeSheet();
      };
    });
  }

  function promptDestination({
    title = "Destination",
    hint = "Enter where you are going.",
    storageKey = STORAGE_KEYS.riderDestination,
    placeholder = "e.g., Accra Mall",
    confirmText = "Save",
  } = {}) {
    return new Promise((resolve) => {
      const body = document.createElement("div");
      const saved = (localStorage.getItem(storageKey) ?? "").trim();
      body.innerHTML = `
        <div class="muted">${hint}</div>
        <label class="field">
          <span class="field__label">Destination</span>
          <input id="sheetDestinationInput" class="input" autocomplete="street-address" placeholder="${placeholder}" />
        </label>
      `;

      openSheet({ title, body, confirmText });
      const input = body.querySelector("#sheetDestinationInput");
      if (input) input.value = saved;

      state.sheet.onClose = () => resolve(null);
      state.sheet.onConfirm = async () => {
        const destination = sanitizeDestinationText(input?.value ?? "");
        if (!destination) {
          setSheetError("Please enter a destination.");
          input?.focus();
          return;
        }
        localStorage.setItem(storageKey, destination);
        state.sheet.onClose = null;
        resolve(destination);
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

  function promptAuthRegister() {
    return new Promise((resolve) => {
      const body = document.createElement("div");
      const savedName = (localStorage.getItem(STORAGE_KEYS.authName) ?? "").trim();
      const savedPhone = (localStorage.getItem(STORAGE_KEYS.authPhone) ?? "").trim();
      const savedEmail = (localStorage.getItem(STORAGE_KEYS.authEmail) ?? "").trim();
      const savedRole = (localStorage.getItem(STORAGE_KEYS.authRole) ?? "").trim().toLowerCase();

      body.innerHTML = `
        <div class="muted">Create your account and choose how you use EWC Rides.</div>
        <label class="field">
          <span class="field__label">Name</span>
          <input id="sheetRegName" class="input" autocomplete="given-name" placeholder="e.g., John" />
        </label>
        <label class="field">
          <span class="field__label">Phone</span>
          <input id="sheetRegPhone" class="input" inputmode="tel" autocomplete="tel" placeholder="e.g., 4045551234" />
        </label>
        <label class="field">
          <span class="field__label">Email</span>
          <input id="sheetRegEmail" class="input" inputmode="email" autocomplete="email" placeholder="e.g., john@email.com" />
        </label>
        <label class="field">
          <span class="field__label">Password</span>
          <input id="sheetRegPassword" class="input" type="password" autocomplete="new-password" placeholder="At least 6 characters" />
        </label>
        <label class="field">
          <span class="field__label">I will use this as</span>
          <select id="sheetRegRole" class="input">
            <option value="driver">A Driver</option>
            <option value="rider">A Rider</option>
          </select>
        </label>
      `;

      openSheet({ title: "Register", body, confirmText: "Create account" });

      const nameInput = body.querySelector("#sheetRegName");
      const phoneInput = body.querySelector("#sheetRegPhone");
      const emailInput = body.querySelector("#sheetRegEmail");
      const passwordInput = body.querySelector("#sheetRegPassword");
      const roleInput = body.querySelector("#sheetRegRole");
      if (nameInput) nameInput.value = savedName;
      if (phoneInput) phoneInput.value = formatPhoneDigits(savedPhone);
      if (emailInput) emailInput.value = savedEmail;
      if (roleInput && (savedRole === "driver" || savedRole === "rider")) roleInput.value = savedRole;

      state.sheet.onClose = () => resolve(null);
      state.sheet.onConfirm = async () => {
        const name = (nameInput?.value ?? "").trim();
        const phoneDigits = digitsOnly(phoneInput?.value ?? "");
        const email = (emailInput?.value ?? "").trim().toLowerCase();
        const password = (passwordInput?.value ?? "").toString();
        const role = (roleInput?.value ?? "").toString().trim().toLowerCase();

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
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          setSheetError("Please enter a valid email address.");
          emailInput?.focus();
          return;
        }
        if (password.length < 6) {
          setSheetError("Password should be at least 6 characters.");
          passwordInput?.focus();
          return;
        }
        if (role !== "driver" && role !== "rider") {
          setSheetError("Please choose a role.");
          roleInput?.focus();
          return;
        }

        state.sheet.onClose = null;
        resolve({ name, phone: phoneDigits, email, password, role });
        closeSheet();
      };
    });
  }

  function promptRoleLogin(role = "") {
    return new Promise((resolve) => {
      const body = document.createElement("div");
      const savedEmail = (localStorage.getItem(STORAGE_KEYS.authEmail) ?? "").trim();
      const roleLabel = role === "driver" ? "driver" : role === "rider" ? "rider" : "your account";

      body.innerHTML = `
        <div class="muted">Sign in to continue as a ${roleLabel}.</div>
        <label class="field">
          <span class="field__label">Email</span>
          <input id="sheetLoginEmail" class="input" inputmode="email" autocomplete="email" placeholder="e.g., john@email.com" />
        </label>
        <label class="field">
          <span class="field__label">Password</span>
          <input id="sheetLoginPassword" class="input" type="password" autocomplete="current-password" placeholder="Your password" />
        </label>
      `;

      openSheet({ title: "Sign in", body, confirmText: "Continue" });

      const emailInput = body.querySelector("#sheetLoginEmail");
      const passwordInput = body.querySelector("#sheetLoginPassword");
      if (emailInput) emailInput.value = savedEmail;

      state.sheet.onClose = () => resolve(null);
      state.sheet.onConfirm = async () => {
        const email = (emailInput?.value ?? "").trim().toLowerCase();
        const password = (passwordInput?.value ?? "").toString();

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          setSheetError("Enter a valid email address.");
          emailInput?.focus();
          return;
        }
        if (!password) {
          setSheetError("Enter your password.");
          passwordInput?.focus();
          return;
        }

        state.sheet.onClose = null;
        resolve({ email, password });
        closeSheet();
      };
    });
  }

  return {
    openSheet,
    closeSheet,
    setSheetError,
    promptRiderContact,
    promptDestination,
    promptDriverContact,
    promptAuthRegister,
    promptRoleLogin,
  };
}
