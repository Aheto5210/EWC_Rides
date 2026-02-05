import { NOTIFY_AUDIO_URL } from "./constants.js";

export function createAudio({ state } = {}) {
  function ensureAudioContext() {
    if (state.audio.ctx) return state.audio.ctx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    state.audio.ctx = new Ctx();
    return state.audio.ctx;
  }

  function ensureNotificationSample() {
    if (state.audio.sampleDisabled) return null;
    if (state.audio.sampleEl) return state.audio.sampleEl;
    try {
      const audio = new Audio(NOTIFY_AUDIO_URL);
      audio.preload = "auto";
      audio.volume = 0.9;
      audio.addEventListener("error", () => {
        state.audio.sampleDisabled = true;
      });
      state.audio.sampleEl = audio;
      return audio;
    } catch {
      state.audio.sampleDisabled = true;
      return null;
    }
  }

  async function unlockAudio() {
    const ctx = ensureAudioContext();
    if (!ctx) return;
    if (ctx.state === "running") {
      state.audio.unlocked = true;
      return;
    }
    try {
      await ctx.resume();
      state.audio.unlocked = true;
    } catch {
      // ignore
    }
  }

  async function primeAlertAudio() {
    await unlockAudio();
    const sample = ensureNotificationSample();
    if (!sample) return;
    try {
      sample.muted = true;
      const p = sample.play();
      if (p && typeof p.then === "function") await p;
      sample.pause();
      sample.currentTime = 0;
      sample.muted = false;
      state.audio.sampleAllowed = true;
    } catch {
      state.audio.sampleAllowed = false;
    }
  }

  function playBellWebAudio() {
    const ctx = ensureAudioContext();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});

    const t0 = ctx.currentTime + 0.02;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t0);
    out.connect(ctx.destination);

    // Simple bell-ish chime: a few partials with fast attack + exponential decay.
    const partials = [
      { f: 880, a: 0.11, d: 0.9 },
      { f: 1320, a: 0.075, d: 0.7 },
      { f: 1760, a: 0.05, d: 0.55 },
    ];

    for (const p of partials) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(p.f, t0);

      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(p.a, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + p.d);
      osc.connect(g);
      g.connect(out);

      osc.start(t0);
      osc.stop(t0 + p.d + 0.05);
      osc.onended = () => {
        try {
          osc.disconnect();
          g.disconnect();
        } catch {
          // ignore
        }
      };
    }

    // Gentle overall envelope to avoid clicks.
    out.gain.setValueAtTime(0.0001, t0);
    out.gain.linearRampToValueAtTime(0.9, t0 + 0.01);
    out.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.0);
  }

  function playAcceptedSound() {
    const ctx = ensureAudioContext();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});

    const t0 = ctx.currentTime + 0.01;

    const master = ctx.createGain();
    master.gain.setValueAtTime(0, t0);
    master.connect(ctx.destination);

    const osc = ctx.createOscillator();
    osc.type = "sine";

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t0);
    gain.connect(master);
    osc.connect(gain);

    const peak = 0.11;
    gain.gain.linearRampToValueAtTime(peak, t0 + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.25);

    osc.frequency.setValueAtTime(988, t0);
    osc.frequency.exponentialRampToValueAtTime(1318, t0 + 0.12);

    osc.start(t0);
    osc.stop(t0 + 0.28);

    osc.onended = () => {
      try {
        osc.disconnect();
        gain.disconnect();
        master.disconnect();
      } catch {
        // ignore
      }
    };
  }

  function playNotificationSound() {
    const now = Date.now();
    if (now - state.audio.lastBeepAt < 900) return;
    state.audio.lastBeepAt = now;

    try {
      if (typeof navigator.vibrate === "function") navigator.vibrate([120, 80, 120]);
    } catch {
      // ignore
    }

    const sample = ensureNotificationSample();
    if (sample && state.audio.sampleAllowed && !state.audio.sampleDisabled) {
      try {
        sample.currentTime = 0;
      } catch {
        // ignore
      }
      const p = sample.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
      setTimeout(() => {
        if (sample.paused) playBellWebAudio();
      }, 160);
      return;
    }

    playBellWebAudio();
  }

  function hasPendingDriverRequests() {
    if (state.role !== "driver") return false;
    for (const r of state.live.requests.values()) {
      if (r.status === "pending") return true;
    }
    return false;
  }

  function stopRequestAlarm() {
    if (state.audio.repeatTimer) clearInterval(state.audio.repeatTimer);
    state.audio.repeatTimer = null;
  }

  function startRequestAlarm() {
    if (state.audio.repeatTimer) return;
    playNotificationSound();
    state.audio.repeatTimer = setInterval(() => {
      if (state.role !== "driver" || !state.driver.online || !hasPendingDriverRequests()) {
        stopRequestAlarm();
        return;
      }
      playNotificationSound();
    }, 1000);
  }

  function updateRequestAlarm() {
    if (state.role !== "driver" || !state.driver.online) {
      stopRequestAlarm();
      return;
    }
    if (hasPendingDriverRequests()) startRequestAlarm();
    else stopRequestAlarm();
  }

  return {
    unlockAudio,
    primeAlertAudio,
    playNotificationSound,
    playAcceptedSound,
    updateRequestAlarm,
    stopRequestAlarm,
  };
}
