import { api } from './api/client.js';
import { publishDataStatus, readApiSnapshot, readLocalRecord, saveLocalRecord, createDataStatusContext } from './apiSnapshot.js';

const categoryFor = (value) => {
  if (value == null || !Number.isFinite(Number(value))) return 'Unavailable';
  const aqi = Number(value);
  if (aqi <= 50) return 'Good';
  if (aqi <= 100) return 'Moderate';
  if (aqi <= 150) return 'Unhealthy for sensitive groups';
  if (aqi <= 200) return 'Unhealthy';
  if (aqi <= 300) return 'Very unhealthy';
  return 'Hazardous';
};

export async function fetchOpenMeteoAirQuality(latitude, longitude, statusContext = createDataStatusContext()) {
  const params = new URLSearchParams({
    latitude: String(latitude), longitude: String(longitude),
    current: 'us_aqi,pm2_5,pm10,ozone,nitrogen_dioxide',
    hourly: 'us_aqi,pm2_5,pm10,ozone,nitrogen_dioxide',
    timezone: 'auto', forecast_hours: '24',
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9000);
  try {
    const response = await fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?${params}`, {
      signal: controller.signal, headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`Air-quality provider returned ${response.status}.`);
    const payload = await response.json();
    const currentRaw = payload.current || {};
    const hourly = payload.hourly || {};
    const currentTime = currentRaw.time || null;
    const currentHourIndex = currentTime && Array.isArray(hourly.time)
      ? Math.max(0, hourly.time.findIndex((time) => time >= currentTime))
      : 0;
    const atCurrentHour = (field) => hourly[field]?.[currentHourIndex] ?? null;
    const current = {
      us_aqi: currentRaw.us_aqi ?? atCurrentHour('us_aqi'),
      pm25: currentRaw.pm2_5 ?? atCurrentHour('pm2_5'),
      pm2_5: currentRaw.pm2_5 ?? atCurrentHour('pm2_5'),
      pm10: currentRaw.pm10 ?? atCurrentHour('pm10'),
      ozone: currentRaw.ozone ?? atCurrentHour('ozone'),
      nitrogen_dioxide: currentRaw.nitrogen_dioxide ?? atCurrentHour('nitrogen_dioxide'),
    };
    current.category = categoryFor(current.us_aqi);
    const forecast = (hourly.time || []).map((time, index) => {
      const us_aqi = hourly.us_aqi?.[index] ?? null;
      return {
        time, us_aqi,
        pm25: hourly.pm2_5?.[index] ?? null,
        pm2_5: hourly.pm2_5?.[index] ?? null,
        pm10: hourly.pm10?.[index] ?? null,
        ozone: hourly.ozone?.[index] ?? null,
        nitrogen_dioxide: hourly.nitrogen_dioxide?.[index] ?? null,
        category: categoryFor(us_aqi),
      };
    }).filter((row) => (!currentTime || row.time >= currentTime) && (row.us_aqi != null || row.pm25 != null)).slice(0, 24);
    if (current.us_aqi == null && current.pm25 == null && forecast.length === 0) throw new Error('The air-quality provider did not return usable readings for this coordinate.');
    const result = {
      status: 'provider_fallback', provider: 'Open-Meteo Air Quality', aqi_scale: 'US AQI 0–500', current, forecast,
      updated_at: currentRaw.time || forecast[0]?.time || new Date().toISOString(),
      note: 'Provider-sourced atmospheric outlook from Open-Meteo. These are forecast-grid values, not ground-station measurements.',
      source: 'Open-Meteo Air Quality API',
    };
    publishDataStatus({ type: 'provider', path: 'air-quality-direct', provider: 'Open-Meteo' }, statusContext);
    return result;
  } finally { clearTimeout(timer); }
}

export async function loadLocationAirQuality(latitude, longitude) {
  const routePath = typeof window === 'undefined' ? '/' : window.location.pathname;
  const storageKey = `aqi-grid:${Number(latitude).toFixed(3)}:${Number(longitude).toFixed(3)}`;
  const apiPath = `/aqi/location-forecast?latitude=${encodeURIComponent(latitude)}&longitude=${encodeURIComponent(longitude)}`;
  let apiError = null;
  let data = null;

  try {
    // The shared client gives the live backend its full retry/grace window.
    // Direct-provider recovery is attempted only after that request fails.
    data = await api.get(apiPath);
  } catch (error) {
    apiError = error;
    const availabilityFailure = !error?.status || error.status >= 500 || error.status === 408 || error.status === 429;
    if (!availabilityFailure) throw error;
  }

  if (data?.current && (data.current.us_aqi != null || data.current.openweather_index != null || data.current.pm25 != null || data.current.pm2_5 != null)) {
    // Prefer a comparable US AQI timeline for users. OpenWeather's 1–5
    // values are a valid backup, but must never be drawn as if they were US AQI.
    const hasUsAqiForecast = Array.isArray(data.forecast) && data.forecast.some((row) => row?.us_aqi != null);
    if (!hasUsAqiForecast) {
      try {
        const providerForecast = await fetchOpenMeteoAirQuality(latitude, longitude, createDataStatusContext(routePath));
        if (providerForecast.forecast.some((row) => row?.us_aqi != null)) {
          data = {
            ...data,
            forecast: providerForecast.forecast,
            forecast_provider: providerForecast.provider,
            forecast_scale: providerForecast.aqi_scale || 'US AQI 0–500',
            note: `${data.note || 'Current air-quality conditions are available.'} The hourly US AQI outlook is supplied separately by ${providerForecast.provider}.`,
          };
        }
      } catch {
        // Keep the available current reading even when a secondary forecast source is unavailable.
      }
    }
    const savedApiSnapshot = readApiSnapshot(apiPath);
    saveLocalRecord(storageKey, data, savedApiSnapshot?.savedAt || Date.now());
    return data;
  }

  const statusContext = createDataStatusContext(routePath);
  try {
    const providerData = await fetchOpenMeteoAirQuality(latitude, longitude, statusContext);
    saveLocalRecord(storageKey, providerData);
    return providerData;
  } catch (providerError) {
    const saved = readLocalRecord(storageKey);
    if (saved?.value?.current) {
      publishDataStatus({ type: 'snapshot', path: storageKey, cachedAt: saved.savedAt, reason: 'Restored the last successful air-quality forecast.' }, statusContext);
      return {
        ...saved.value,
        status: 'cached_provider',
        note: `${saved.value.note || 'Air-quality forecast.'} The provider is currently unavailable; this is the last successfully saved forecast, not a new reading.`,
      };
    }
    if (apiError) providerError.cause = apiError;
    throw providerError;
  }
}
