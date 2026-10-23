import { useCallback, useState } from 'react';
import { Activity, AlertTriangle, CheckCircle2, Clock3, LocateFixed, MapPin, RefreshCw, Wind } from 'lucide-react';
import PageIntro from '../../components/shared/PageIntro.jsx';
import CityMap from '../../components/maps/CityMap.jsx';
import { api } from '../../services/api/client.js';
import './location-aqi.css';

const fmt = (n, digits = 1) => n == null || !Number.isFinite(Number(n)) ? '—' : Number(n).toFixed(digits);
const hour = (s) => { try { return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(s)); } catch { return s; } };
const categoryClass = (name = '') => name.toLowerCase().replaceAll(' ', '-');

function categoryForAqi(value) {
  if (value == null || !Number.isFinite(Number(value))) return 'Unavailable';
  const n = Number(value);
  if (n <= 50) return 'Good';
  if (n <= 100) return 'Moderate';
  if (n <= 150) return 'Unhealthy for sensitive groups';
  if (n <= 200) return 'Unhealthy';
  if (n <= 300) return 'Very unhealthy';
  return 'Hazardous';
}

async function fetchOpenMeteoDirect(latitude, longitude) {
  const params = new URLSearchParams({
    latitude: String(latitude), longitude: String(longitude), timezone: 'auto', forecast_hours: '24',
    current: 'us_aqi,european_aqi,pm2_5,pm10,nitrogen_dioxide,ozone,carbon_monoxide,sulphur_dioxide',
    hourly: 'us_aqi,european_aqi,pm2_5,pm10',
  });
  const response = await fetch(`https://air-quality-api.open-meteo.com/v1/air-quality?${params}`, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Air quality provider returned ${response.status}`);
  const payload = await response.json();
  const current = payload.current || {};
  const hourly = payload.hourly || {};
  const times = hourly.time || [];
  const values = hourly.us_aqi || [];
  const pm25 = hourly.pm2_5 || [];
  const pm10 = hourly.pm10 || [];
  return {
    status: current.us_aqi == null ? 'partial' : 'available', provider: 'Open-Meteo / CAMS',
    latitude: payload.latitude ?? latitude, longitude: payload.longitude ?? longitude,
    timezone: payload.timezone, updated_at: current.time,
    current: { us_aqi: current.us_aqi ?? null, european_aqi: current.european_aqi ?? null,
      category: categoryForAqi(current.us_aqi), pm25: current.pm2_5 ?? null, pm10: current.pm10 ?? null,
      nitrogen_dioxide: current.nitrogen_dioxide ?? null, ozone: current.ozone ?? null,
      carbon_monoxide: current.carbon_monoxide ?? null, sulphur_dioxide: current.sulphur_dioxide ?? null },
    forecast: times.map((time, i) => ({ time, us_aqi: values[i] ?? null, category: categoryForAqi(values[i]), pm25: pm25[i] ?? null, pm10: pm10[i] ?? null })).slice(0, 24),
    model: 'CAMS atmospheric composition forecast',
    note: 'Location-based atmospheric model forecast, not an official ground-station measurement. Values depend on the provider update cycle.',
  };
}

export default function AqiVisionPage() {
  const [location, setLocation] = useState(null);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);

  const loadForecast = useCallback(async (latitude, longitude, label) => {
    setLoading(true); setError('');
    try {
      let data;
      try { data = await api.get(`/aqi/location-forecast?latitude=${latitude}&longitude=${longitude}`); }
      catch { data = null; }
      // Open-Meteo supports browser CORS and does not require an API key, so the
      // UI can still retrieve a real forecast when this backend is unreachable.
      if (!data || data.status === 'unavailable' || data.current?.us_aqi == null) {
        try { data = await fetchOpenMeteoDirect(latitude, longitude); }
        catch (fallbackError) {
          if (!data || data.current?.us_aqi == null) throw fallbackError;
        }
      }
      setReport(data);
      if (data.status === 'unavailable' || data.current?.us_aqi == null) setError(data.note || 'Air quality forecast is temporarily unavailable for this location.');
      setLastUpdated(new Date().toISOString());
      setLocation({ latitude, longitude, label: label || `${latitude.toFixed(4)}, ${longitude.toFixed(4)}` });
    } catch (err) {
      setReport({ status: 'unavailable', current: { us_aqi: null, category: 'Unavailable', pm25: null, pm10: null }, forecast: [], note: 'The air quality service could not be reached. Try again when connectivity returns; no unrelated value is substituted.' });
      setError(err?.message || 'Could not retrieve an air-quality forecast.');
    } finally { setLoading(false); }
  }, []);

  const useCurrentLocation = useCallback(() => {
    if (!navigator.geolocation) { setError('Location access is not available in this browser.'); return; }
    setLocating(true); setError('');
    navigator.geolocation.getCurrentPosition(async ({ coords }) => {
      const latitude = coords.latitude, longitude = coords.longitude;
      let label = 'Your current location';
      try { const place = await api.get(`/routing/reverse-geocode?latitude=${latitude}&longitude=${longitude}`); label = place.label || label; } catch { /* coordinates still identify the forecast location */ }
      setLocating(false);
      loadForecast(latitude, longitude, label);
    }, (err) => {
      setLocating(false);
      setError(err.code === 1 ? 'Location permission was denied. Allow location access in your browser and try again.' : 'Could not get your location. Check device location services and retry.');
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
  }, [loadForecast]);

  const current = report?.current || {};
  const markers = location ? [{ id: 'aqi-location', lat: location.latitude, lng: location.longitude, title: location.label, description: current.us_aqi == null ? 'Air-quality forecast unavailable' : `Forecast US AQI ${Math.round(current.us_aqi)} · ${current.category}`, kind: current.us_aqi >= 151 ? 'critical' : current.us_aqi >= 101 ? 'busy' : 'normal' }] : [];
  const visibleForecast = (report?.forecast || []).filter((item) => item.us_aqi != null).slice(0, 12);

  return <div className="location-aqi-page">
    <PageIntro eyebrow="PERSONALISED AIR OUTLOOK" title="Air quality where you are" description="Share your current location to get the nearby air-quality outlook and the next 24 hours of forecast conditions." action={<button className="utility" type="button" onClick={() => location && loadForecast(location.latitude, location.longitude, location.label)} disabled={!location || loading}><RefreshCw size={14}/>{loading ? 'Updating…' : 'Refresh forecast'}</button>} />
    <section className="panel aqi-location-hero">
      <div className="aqi-location-copy"><span className="aqi-location-icon"><LocateFixed size={20}/></span><div><span className="eyebrow">YOUR LOCATION</span><h2>{location?.label || 'Get your local air forecast'}</h2><p>{location ? `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}` : 'No address needed. Your browser shares coordinates only after you grant permission.'}</p></div></div>
      <button className="primary aqi-location-button" type="button" onClick={useCurrentLocation} disabled={locating || loading}><LocateFixed size={16}/>{locating ? 'Finding your location…' : location ? 'Update my location' : 'Use my current location'}</button>
    </section>
    {error && <div className="aqi-location-notice"><AlertTriangle size={16}/><span>{error}</span><button type="button" onClick={() => location && loadForecast(location.latitude, location.longitude, location.label)}>Retry</button></div>}
    {!report && <section className="panel aqi-location-empty"><span><Wind size={30}/></span><h3>Your local AQI outlook will appear here</h3><p>Tap “Use my current location” to load current modelled conditions and an hourly outlook.</p></section>}
    {report && <>
      <div className="aqi-current-grid">
        <section className={`panel aqi-current-card aqi-category-${categoryClass(current.category)}`}><div className="aqi-current-heading"><div><span className="eyebrow">CURRENT LOCAL OUTLOOK</span><h3>{current.category || 'Unavailable'}</h3></div><span className="aqi-source-pill">{report.status === 'available' ? 'Forecast updated' : 'No current value'}</span></div><div className="aqi-current-value"><strong>{current.us_aqi == null ? '—' : Math.round(current.us_aqi)}</strong><span>US AQI</span></div><p>{current.us_aqi == null ? 'No current value was returned for this location.' : 'A location-based atmospheric model estimate, not a ground-station measurement.'}</p><div className="aqi-current-footer"><span><Clock3 size={13}/> Provider time: {report.updated_at ? hour(report.updated_at) : 'unavailable'}</span><span>{report.provider || 'Source unavailable'}</span></div></section>
        <section className="panel aqi-pollutant-card"><div className="eyebrow">POLLUTANTS</div><h3>Air composition</h3><div className="aqi-pollutant-grid"><div><small>PM2.5</small><b>{fmt(current.pm25)} <small>µg/m³</small></b></div><div><small>PM10</small><b>{fmt(current.pm10)} <small>µg/m³</small></b></div><div><small>Ozone</small><b>{fmt(current.ozone)} <small>µg/m³</small></b></div><div><small>Nitrogen dioxide</small><b>{fmt(current.nitrogen_dioxide)} <small>µg/m³</small></b></div></div><p>Pollutant concentrations use the provider’s forecast grid for your coordinates.</p></section>
      </div>
      <section className="panel aqi-outlook-panel"><div className="panel-head"><div><div className="eyebrow">NEXT 12 HOURS</div><h3>Hourly AQI outlook</h3></div><span className="status-pill">{visibleForecast.length} forecast points</span></div>{visibleForecast.length ? <div className="aqi-hourly-grid">{visibleForecast.map((item) => <article className="aqi-hourly-item" key={item.time}><small>{hour(item.time)}</small><strong>{Math.round(item.us_aqi)}</strong><span className={`aqi-mini-category category-${categoryClass(item.category)}`}>{item.category}</span><div className="aqi-mini-bar"><i style={{ height: `${Math.max(7, Math.min(100, Number(item.us_aqi) / 3.5))}%` }}/></div></article>)}</div> : <div className="aqi-location-empty compact"><AlertTriangle size={20}/><b>Hourly forecast unavailable</b><p>The provider did not return forecast points. Refresh to try again.</p></div>}<p className="aqi-attribution-note">Source: <a href="https://open-meteo.com/en/docs/air-quality-api" target="_blank" rel="noreferrer">Open-Meteo Air Quality API</a> using CAMS atmospheric composition forecasts. {report.note}</p></section>
      <div className="aqi-location-bottom"><section className="panel aqi-location-map-panel"><div className="panel-head"><div><div className="eyebrow">MAP</div><h3>Forecast location</h3></div><MapPin size={17}/></div><CityMap markers={markers} city="Delhi NCR" zoom={14}/></section><section className="panel aqi-location-explainer"><CheckCircle2 size={19}/><h3>How to read this result</h3><p>This page uses your coordinates to request a forecast grid cell. Values can differ from an air-quality monitoring station nearby, and a forecast is not a medical or regulatory measurement.</p><small>Last request: {lastUpdated ? new Date(lastUpdated).toLocaleTimeString() : 'Not updated'}</small></section></div>
    </>}
  </div>;
}
