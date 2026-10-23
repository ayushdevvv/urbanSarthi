import { useEffect, useMemo, useState } from 'react';
import { Activity, CheckCircle2, Clock3, LocateFixed, MapPin, RefreshCw, Search, Wind } from 'lucide-react';
import PageIntro from '../../components/shared/PageIntro.jsx';
import CityMap from '../../components/maps/CityMap.jsx';
import { EmptyState, ErrorNotice } from '../../components/shared/Toast.jsx';
import useApiResource from '../../hooks/useApiResource.js';
import { api, endpoints } from '../../services/api/client.js';

const DEFAULT_LOCATION = { name: 'Delhi NCR', latitude: 28.6139, longitude: 77.209 };
const AIR_API = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const GEO_API = 'https://geocoding-api.open-meteo.com/v1/search';

function aqiBand(value) {
  if (value == null || !Number.isFinite(Number(value))) return { label: 'Unavailable', tone: 'unknown' };
  const n = Number(value);
  if (n <= 50) return { label: 'Good', tone: 'good' };
  if (n <= 100) return { label: 'Moderate', tone: 'moderate' };
  if (n <= 150) return { label: 'Unhealthy for sensitive groups', tone: 'sensitive' };
  if (n <= 200) return { label: 'Unhealthy', tone: 'unhealthy' };
  if (n <= 300) return { label: 'Very unhealthy', tone: 'very-unhealthy' };
  return { label: 'Hazardous', tone: 'hazardous' };
}

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`The air-quality service returned ${response.status}. Please try again.`);
  const data = await response.json();
  if (data?.error) throw new Error(data.reason || 'The air-quality service could not return data for this location.');
  return data;
}

async function geocodeCity(query) {
  const params = new URLSearchParams({ name: query, count: '5', language: 'en', format: 'json' });
  const data = await getJson(`${GEO_API}?${params.toString()}`);
  const results = data.results || [];
  if (!results.length) throw new Error(`No matching location found for “${query}”. Try a nearby city or town name.`);
  const preferred = results.find((item) => String(item.country_code || '').toUpperCase() === 'IN') || results[0];
  return { name: [preferred.name, preferred.admin1, preferred.country].filter(Boolean).join(', '), latitude: preferred.latitude, longitude: preferred.longitude };
}

async function loadAirForecast(latitude, longitude) {
  const params = new URLSearchParams({
    latitude: String(latitude), longitude: String(longitude),
    current: 'us_aqi,pm2_5,pm10,nitrogen_dioxide,ozone',
    hourly: 'us_aqi,pm2_5,pm10,nitrogen_dioxide,ozone',
    forecast_hours: '36', timezone: 'auto', timeformat: 'iso8601',
  });
  return getJson(`${AIR_API}?${params.toString()}`);
}

function age(date) {
  if (!date) return 'Time unavailable';
  const mins = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 60000));
  return mins < 1 ? 'Updated just now' : mins < 60 ? `Updated ${mins} min ago` : `Updated ${Math.floor(mins / 60)} hr ago`;
}
const value = (n, unit = '') => n == null || !Number.isFinite(Number(n)) ? '—' : `${Number(n).toFixed(Number(n) % 1 ? 1 : 0)}${unit}`;

export default function AirQualityPage() {
  const [locationQuery, setLocationQuery] = useState(DEFAULT_LOCATION.name);
  const [location, setLocation] = useState(DEFAULT_LOCATION);
  const [forecast, setForecast] = useState(null);
  const [forecastBusy, setForecastBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState('');
  const [forecastError, setForecastError] = useState('');
  const { data: observations, loading, error, reload } = useApiResource(
    () => api.get(endpoints.aqi(location.latitude, location.longitude)),
    [location.latitude, location.longitude],
  );

  const stations = Array.isArray(observations) ? [...observations].sort((a, b) => (b.aqi ?? -1) - (a.aqi ?? -1)) : [];
  const markers = useMemo(() => stations.filter((item) => Number.isFinite(item.latitude) && Number.isFinite(item.longitude)).map((item) => ({
    id: item.id, lat: item.latitude, lng: item.longitude, title: item.station_name,
    description: `Reported AQI ${item.aqi ?? 'not supplied'} · ${item.source}`,
    kind: item.aqi >= 200 ? 'critical' : item.aqi >= 100 ? 'busy' : 'normal',
  })), [observations]);
  const validAqi = stations.filter((item) => item.aqi != null);
  const stationAverage = validAqi.length ? Math.round(validAqi.reduce((sum, item) => sum + item.aqi, 0) / validAqi.length) : null;
  const primary = stations.find((item) => item.aqi != null) || stations[0];
  const current = forecast?.current || null;
  const currentBand = aqiBand(current?.us_aqi);
  const hourly = forecast?.hourly || {};
  const forecastSlots = useMemo(() => {
    if (!hourly.time?.length) return [];
    const referenceTime = current?.time || new Date().toISOString().slice(0, 13) + ':00';
    let start = hourly.time.findIndex((time) => time >= referenceTime);
    if (start < 0) start = 0;
    return hourly.time.slice(start, start + 12).map((time, index) => {
      const i = start + index;
      const aqi = hourly.us_aqi?.[i];
      return { time, aqi, ...aqiBand(aqi), pm25: hourly.pm2_5?.[i], pm10: hourly.pm10?.[i] };
    });
  }, [hourly, current?.time]);

  async function refreshForecast(target = location) {
    setForecastBusy(true);
    setForecastError('');
    try {
      const data = await loadAirForecast(target.latitude, target.longitude);
      setForecast(data);
      setLocationError('');
    } catch (err) {
      setForecastError(err.message || 'Could not load forecast data.');
    } finally {
      setForecastBusy(false);
    }
  }

  useEffect(() => { refreshForecast(DEFAULT_LOCATION); }, []);

  async function searchLocation(event) {
    event.preventDefault();
    const query = locationQuery.trim();
    if (!query) { setLocationError('Enter a city, town or locality first.'); return; }
    setLocationError('');
    setForecastError('');
    setForecast(null);
    setForecastBusy(true);
    try {
      const found = await geocodeCity(query);
      setLocation(found);
      setLocationQuery(found.name);
      const data = await loadAirForecast(found.latitude, found.longitude);
      setForecast(data);
    } catch (err) {
      setLocationError(err.message || 'Could not find that location.');
    } finally {
      setForecastBusy(false);
    }
  }

  async function useCurrentLocation() {
    setLocationError('');
    setForecastError('');
    if (!navigator.geolocation) { setLocationError('This browser does not support location access. Search for a city instead.'); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(async (position) => {
      const target = { name: 'Current location', latitude: position.coords.latitude, longitude: position.coords.longitude };
      try {
        try {
          const params = new URLSearchParams({ format: 'jsonv2', lat: String(target.latitude), lon: String(target.longitude) });
          const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`);
          if (response.ok) {
            const address = (await response.json()).address || {};
            target.name = [address.city || address.town || address.village || address.county || address.state, address.state, address.country].filter(Boolean).filter((v, i, arr) => arr.indexOf(v) === i).join(', ') || 'Current location';
          }
        } catch { /* Reverse lookup is optional: coordinates alone are enough for the forecast. */ }
        setLocation(target);
        setLocationQuery(target.name);
        await refreshForecast(target);
      } catch (err) {
        setLocationError(err.message || 'Could not load nearby air-quality forecasts.');
      } finally {
        setLocating(false);
      }
    }, () => {
      setLocating(false);
      setLocationError('Location permission was not granted. Search by city or town instead.');
    }, { enableHighAccuracy: false, timeout: 12000, maximumAge: 300000 });
  }

  return <div className="air-quality-page">
    <PageIntro eyebrow="LOCATION-BASED AIR QUALITY" title="Know the air before you go" description="Search any city to view a modelled AQI forecast, upcoming hourly changes and pollutant concentrations alongside available station observations." action={<button className="utility" onClick={() => { refreshForecast(); reload(); }} disabled={forecastBusy}><RefreshCw size={15}/>{forecastBusy ? 'Refreshing…' : 'Refresh forecast'}</button>} />

    <section className="panel aq-forecast-panel">
      <div className="aq-forecast-heading"><div><span className="aq-forecast-kicker"><Wind size={15}/> CITY AIR QUALITY FORECAST</span><h3>Forecast for your location</h3><p>Enter a city or use your current location to load hourly air-quality estimates.</p></div><span className="aq-forecast-provider">Powered by Open-Meteo · CAMS</span></div>
      <form className="aq-location-form" onSubmit={searchLocation}>
        <label><span>Location</span><div className="aq-location-input"><MapPin size={18}/><input value={locationQuery} onChange={(event) => setLocationQuery(event.target.value)} placeholder="Enter city, e.g. Lucknow" aria-label="Search city for AQI forecast"/></div></label>
        <button type="submit" className="primary" disabled={forecastBusy}><Search size={17}/>{forecastBusy ? 'Loading…' : 'Get AQI forecast'}</button>
        <button type="button" className="secondary" onClick={useCurrentLocation} disabled={locating}><LocateFixed size={17}/>{locating ? 'Finding location…' : 'Use my location'}</button>
      </form>
      {locationError && <div className="aq-inline-error">{locationError}</div>}
      {forecastError && <div className="aq-inline-error">{forecastError}</div>}
      <div className="aq-forecast-place"><CheckCircle2 size={15}/><span><b>{location.name}</b><small>{location.latitude.toFixed(3)}, {location.longitude.toFixed(3)} · Forecast grid near selected coordinates</small></span><button type="button" onClick={() => refreshForecast()} disabled={forecastBusy}><RefreshCw size={14}/> Update</button></div>

      {current ? <>
        <div className="aq-current-grid">
          <div className={`aq-current-summary tone-${currentBand.tone}`}><span className="aq-current-label">MODELLED US AQI · CURRENT</span><div className="aq-current-number">{current.us_aqi ?? '—'}</div><b>{currentBand.label}</b><small>{current.time ? `Valid at ${current.time.replace('T', ' ')}` : 'Current model estimate'}</small></div>
          <div className="aq-pollutant-cards">
            <article><span>PM2.5</span><b>{value(current.pm2_5, ' µg/m³')}</b><small>Fine particles</small></article>
            <article><span>PM10</span><b>{value(current.pm10, ' µg/m³')}</b><small>Coarse particles</small></article>
            <article><span>NO₂</span><b>{value(current.nitrogen_dioxide, ' µg/m³')}</b><small>Nitrogen dioxide</small></article>
            <article><span>O₃</span><b>{value(current.ozone, ' µg/m³')}</b><small>Ozone</small></article>
          </div>
        </div>
        <div className="aq-hourly-heading"><div><span className="aq-forecast-kicker"><Clock3 size={15}/> NEXT 12 HOURS</span><h4>How air quality may change</h4></div><span>Hourly model forecast</span></div>
        <div className="aq-hourly-strip">{forecastSlots.map((slot, index) => <article className={`aq-hour-slot tone-${slot.tone}`} key={`${slot.time}-${index}`}><small>{index === 0 ? 'NOW' : new Date(slot.time).toLocaleTimeString([], { hour: 'numeric' })}</small><b>{slot.aqi ?? '—'}</b><span className="aq-hour-bar"><i style={{ height: `${Math.max(5, Math.min(100, Number(slot.aqi || 0) / 3))}%` }}/></span><em>{slot.label}</em></article>)}</div>
      </> : <div className="aq-forecast-empty">{forecastBusy ? 'Loading location-based air-quality forecast…' : 'Forecast data is not available yet. Search a location or refresh the forecast.'}</div>}
      <p className="aq-forecast-disclaimer">Forecast values use the provider’s <b>US AQI scale</b> and atmospheric model. They are not official CPCB/Indian AQI station readings and can differ from local monitors. Data source: Open-Meteo Air Quality API (CAMS forecast).</p>
    </section>

    <div className="aq-station-section-head"><div><span className="aq-forecast-kicker"><Activity size={15}/> CONNECTED STATION DATA</span><h3>Available monitoring observations</h3><p>These are records returned by the UrbanSaarthi backend for the selected coordinates, not the modelled forecast above.</p></div><span className="status-pill">{stations.length} records</span></div>
    <ErrorNotice message={error} onRetry={reload}/>
    <div className="aqi-top-grid"><section className="panel aqi-map-panel"><div className="panel-head"><div><div className="eyebrow">STATION MAP</div><h3>Nearby observations</h3></div><span className="status-pill">{stations.length} stations</span></div><CityMap markers={markers} zoom={11} className="aqi-map"/><div className="map-foot"><span><Wind size={13}/> Station locations</span><small>Only records with coordinates are plotted</small></div></section>
      <aside className="panel aqi-feature"><div className="aqi-gauge"><div><b>{stationAverage ?? '—'}</b><small>STATION AVG</small></div></div><h3>{stationAverage == null ? 'No station AQI average' : primary?.category || 'Reported station observations'}</h3><p>{primary ? `${primary.station_name} · ${age(primary.observed_at)}` : 'No configured station records are available near this location.'}</p><div className="pollutant-block"><small>Primary pollutant · PM2.5</small><b>{value(primary?.pm25, ' µg/m³')}</b></div><p className="api-note">Station AQI and pollutant values appear only when supplied by the configured source. OpenAQ concentrations are not automatically relabelled as official CPCB AQI.</p></aside></div>
    <div className="station-grid">{loading ? <div className="panel loading-lines">Loading station observations…</div> : stations.length ? stations.map((station) => <article className="panel station-card" key={station.id}><div className="station-card-top"><span>{station.source}</span><b className={station.aqi == null ? '' : station.aqi >= 200 ? 'aqi-critical' : station.aqi >= 100 ? 'aqi-warning' : 'aqi-normal'}>{station.aqi ?? '—'}</b></div><h3>{station.station_name}</h3><small>{age(station.observed_at)}</small><div className="pollutant-grid"><div><small>PM2.5</small><b>{value(station.pm25)}</b></div><div><small>PM10</small><b>{value(station.pm10)}</b></div><div><small>NO₂</small><b>{value(station.no2)}</b></div><div><small>O₃</small><b>{value(station.o3)}</b></div></div><div className="station-card-footer"><span>{station.category || 'Category not supplied'}</span><span>{Number(station.latitude).toFixed(3)}, {Number(station.longitude).toFixed(3)}</span></div></article>) : <div className="panel station-empty"><EmptyState title="No configured station observations nearby" description="The location-based forecast above may still work even when no CPCB/CAAQMS or other authorized station observations have been ingested into UrbanSaarthi."/></div>}</div>
  </div>;
}
