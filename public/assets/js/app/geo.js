export function createGeo({ state, els, onChange } = {}) {
  function setLocationText() {
    if (!els?.locationText || !els?.btnEnableLocation) return;
    if (!("geolocation" in navigator)) {
      els.locationText.textContent = "Location not supported on this device.";
      els.btnEnableLocation.hidden = true;
      return;
    }

    if (state.geo.last) {
      els.locationText.textContent = "Location ready.";
      els.btnEnableLocation.hidden = true;
      return;
    }

    if (state.geo.error) {
      els.locationText.textContent = `Location needed: ${state.geo.error}`;
      els.btnEnableLocation.hidden = false;
      return;
    }

    els.locationText.textContent = "Allow location to show nearby drivers.";
    els.btnEnableLocation.hidden = false;
    els.btnEnableLocation.disabled = state.geo.inFlight;
    els.btnEnableLocation.textContent = state.geo.inFlight
      ? "Requesting…"
      : "Allow location";
  }

  async function primeLocation() {
    if (state.geo.inFlight) return;
    if (!("geolocation" in navigator)) {
      setLocationText();
      return;
    }
    state.geo.inFlight = true;
    state.geo.error = null;
    setLocationText();
    try {
      const pos = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          maximumAge: 0,
          timeout: 12_000,
        });
      });
      const c = pos.coords;
      state.geo.last = {
        lat: c.latitude,
        lng: c.longitude,
        accuracyM: c.accuracy,
        heading: c.heading ?? null,
        speedMps: c.speed ?? null,
        updatedAt: Date.now(),
      };
      state.geo.error = null;
      startGeoWatch();
      setLocationText();
      onChange?.();
    } catch (e) {
      const code = Number(e?.code);
      if (!Number.isNaN(code) && code === 1) {
        state.geo.error = "Permission denied. Enable Location for this site.";
      } else if (!Number.isNaN(code) && code === 2) {
        state.geo.error = "Location unavailable. Turn on GPS.";
      } else if (!Number.isNaN(code) && code === 3) {
        state.geo.error = "Timed out. Tap “Allow location” to retry.";
      } else {
        state.geo.error = "Could not get location.";
      }
      setLocationText();
      onChange?.();
    } finally {
      state.geo.inFlight = false;
      setLocationText();
    }
  }

  function startGeoWatch() {
    if (!("geolocation" in navigator)) return;
    if (state.geo.watchId != null) return;

    state.geo.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const c = pos.coords;
        state.geo.last = {
          lat: c.latitude,
          lng: c.longitude,
          accuracyM: c.accuracy,
          heading: c.heading ?? null,
          speedMps: c.speed ?? null,
          updatedAt: Date.now(),
        };
        state.geo.error = null;
        setLocationText();
        onChange?.();
      },
      (err) => {
        const code = Number(err?.code);
        if (!Number.isNaN(code) && code === 1) {
          state.geo.error = "Permission denied. Enable Location for this site.";
        } else if (!Number.isNaN(code) && code === 2) {
          state.geo.error = "Location unavailable. Turn on GPS.";
        } else if (!Number.isNaN(code) && code === 3) {
          state.geo.error = "Timed out. Tap “Allow location” to retry.";
        } else {
          state.geo.error = "Could not get location.";
        }
        setLocationText();
        onChange?.();
      },
      { enableHighAccuracy: true, maximumAge: 3_000, timeout: 12_000 },
    );
  }

  function stopGeoWatch() {
    if (state.geo.watchId == null) return;
    navigator.geolocation.clearWatch(state.geo.watchId);
    state.geo.watchId = null;
  }

  return { setLocationText, primeLocation, startGeoWatch, stopGeoWatch };
}

