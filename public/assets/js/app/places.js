import { DESTINATION_SEED_SUGGESTIONS, GOOGLE_MAPS_API_KEY } from "./constants.js";
import { sanitizeDestinationText } from "./utils.js";

function uniq(values = []) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const normalized = sanitizeDestinationText(value);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function normalizeMapsKey(key) {
  const value = String(key || "").trim();
  if (!value || value.includes("__GOOGLE_MAPS_API_KEY__")) return "";
  return value;
}

export function createPlaces() {
  let apiKey = normalizeMapsKey(GOOGLE_MAPS_API_KEY);
  let scriptPromise = null;
  let service = null;
  let geocoder = null;

  const seeds = uniq(DESTINATION_SEED_SUGGESTIONS).slice(0, 3);

  function fallbackSuggestions(query = "") {
    const q = sanitizeDestinationText(query).toLowerCase();
    if (!q) return seeds.slice(0, 3);
    const fromSeeds = seeds.filter((entry) => entry.toLowerCase().includes(q));
    return uniq(fromSeeds).slice(0, 3);
  }

  function mapsAvailable() {
    return Boolean(
      globalThis.google?.maps?.places?.AutocompleteService && globalThis.google?.maps?.Geocoder,
    );
  }

  async function loadMaps() {
    if (!apiKey) return false;
    if (mapsAvailable()) return true;
    if (scriptPromise) return scriptPromise;

    scriptPromise = new Promise((resolve) => {
      try {
        const script = document.createElement("script");
        script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
          apiKey,
        )}&libraries=places`;
        script.async = true;
        script.defer = true;
        script.onload = () => resolve(mapsAvailable());
        script.onerror = () => resolve(false);
        document.head.appendChild(script);
      } catch {
        resolve(false);
      }
    });

    return scriptPromise;
  }

  function setApiKey(nextKey) {
    const normalized = normalizeMapsKey(nextKey);
    if (!normalized || normalized === apiKey) return;
    apiKey = normalized;
    scriptPromise = null;
    service = null;
    geocoder = null;
  }

  async function ensureService() {
    const ok = await loadMaps();
    if (!ok) return false;
    if (!service && globalThis.google?.maps?.places?.AutocompleteService) {
      service = new globalThis.google.maps.places.AutocompleteService();
    }
    if (!geocoder && globalThis.google?.maps?.Geocoder) {
      geocoder = new globalThis.google.maps.Geocoder();
    }
    return Boolean(service);
  }

  async function suggest(query = "") {
    const input = sanitizeDestinationText(query);
    if (!input) return fallbackSuggestions("");

    const ready = await ensureService();
    if (!ready || !service) {
      const merged = uniq([...fallbackSuggestions(input), input]);
      return merged.slice(0, 3);
    }

    try {
      const results = await new Promise((resolve) => {
        service.getPlacePredictions(
          {
            input,
            componentRestrictions: { country: "gh" },
          },
          (predictions = [], status) => {
            const okStatus = globalThis.google?.maps?.places?.PlacesServiceStatus?.OK;
            if (status !== okStatus) return resolve([]);
            resolve(predictions);
          },
        );
      });

      const fromGoogle = Array.isArray(results)
        ? results.map((entry) => sanitizeDestinationText(entry?.description)).filter(Boolean)
        : [];
      const merged = uniq([...fromGoogle, ...fallbackSuggestions(input), input]);
      return merged.slice(0, 3);
    } catch {
      const merged = uniq([...fallbackSuggestions(input), input]);
      return merged.slice(0, 3);
    }
  }

  async function reverseGeocode({ lat, lng } = {}) {
    if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return "";
    const ready = await ensureService();
    if (!ready || !geocoder) return "";
    try {
      const result = await geocoder.geocode({
        location: { lat: Number(lat), lng: Number(lng) },
      });
      const first = Array.isArray(result?.results) ? result.results[0] : null;
      return sanitizeDestinationText(first?.formatted_address || "");
    } catch {
      return "";
    }
  }

  return {
    suggest,
    reverseGeocode,
    setApiKey,
    seedSuggestions: seeds,
    hasGooglePlaces: () => Boolean(apiKey),
  };
}
