import { api } from './api/client.js';
import { publishDataStatus, readApiSnapshot, readLocalRecord, saveLocalRecord } from './apiSnapshot.js';

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

export async function fetchOpenMeteoAirQuality(latitude, longitude) {
  const params = new URLSearchParams({
    latitude: String(latitude), longitude: String(longitude),
    current: 'us_aqi,pm2_5,pm10,ozone,nitrogen_dioxide',
    hourly: 'us_aqi,pm2_5,pm10,ozone,nitrogen_dioxide',
    timezone: 'auto', forecast_days: '1',
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
    const current = {
      us_aqi: currentRaw.us_aqi ?? hourly.us_aqi?.[0] ?? null,
      pm25: currentRaw.pm2_5 ?? hourly.pm2_5?.[0] ?? null,
      pm2_5: currentRaw.pm2_5 ?? hourly.pm2_5?.[0] ?? null,
      pm10: currentRaw.pm10 ?? hourly.pm10?.[0] ?? null,
      ozone: currentRaw.ozone ?? hourly.ozone?.[0] ?? null,
      nitrogen_dioxide: currentRaw.nitrogen_dioxide ?? hourly.nitrogen_dioxide?.[0] ?? null,
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
    }).filter((row) => row.us_aqi != null || row.pm25 != null);
    if (current.us_aqi == null && current.pm25 == null && forecast.length === 0) throw new Error('The air-quality provider did not return usable readings for this coordinate.');
    const result = {
      status: 'provider_fallback', provider: 'Open-Meteo Air Quality', current, forecast,
      updated_at: currentRaw.time || forecast[0]?.time || new Date().toISOString(),
      note: 'Retrieved directly from Open-Meteo because the UrbanSaarthi API was unavailable. These are forecast-grid values, not ground-station measurements.',
      source: 'Open-Meteo Air Quality API',
    };
    publishDataStatus({ type: 'provider', path: 'air-quality-direct', provider: 'Open-Meteo' });
    return result;
  } finally { clearTimeout(timer); }
}

export async function loadLocationAirQuality(latitude, longitude) {
  const storageKey = `aqi-grid:${Number(latitude).toFixed(3)}:${Number(longitude).toFixed(3)}`;
  try {
    const apiPath = `/aqi/location-forecast?latitude=${encodeURIComponent(latitude)}&longitude=${encodeURIComponent(longitude)}`;
    const data = await api.get(apiPath);
    if (data?.current && (data.current.us_aqi != null || data.current.openweather_index != null || data.current.pm25 != null || data.current.pm2_5 != null)) {
      const savedApiSnapshot = readApiSnapshot(apiPath);
      saveLocalRecord(storageKey, data, savedApiSnapshot?.savedAt || Date.now());
      return data;
    }
    const providerData = await fetchOpenMeteoAirQuality(latitude, longitude);
    saveLocalRecord(storageKey, providerData);
    return providerData;
  } catch (error) {
    try {
      const providerData = await fetchOpenMeteoAirQuality(latitude, longitude);
      saveLocalRecord(storageKey, providerData);
      return providerData;
    } catch (providerError) {
      const saved = readLocalRecord(storageKey);
      if (saved?.value?.current) {
        publishDataStatus({ type: 'snapshot', path: storageKey, cachedAt: saved.savedAt, reason: 'Restored the last successful air-quality forecast.' });
        return {
          ...saved.value,
          status: 'cached_provider',
          note: `${saved.value.note || 'Air-quality forecast.'} The provider is currently unavailable; this is the last successfully saved forecast, not a new reading.`,
        };
      }
      providerError.cause = error;
      throw providerError;
    }
  }
}
