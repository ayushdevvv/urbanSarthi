import { useCallback, useState } from 'react';
import { Activity, AlertTriangle, Clock3, LocateFixed, MapPin, RefreshCw, Search, Wind } from 'lucide-react';
import PageIntro from '../../components/shared/PageIntro.jsx';
import CityMap from '../../components/maps/CityMap.jsx';
import { api } from '../../services/api/client.js';
import { loadLocationAirQuality } from '../../services/airQuality.js';
import './location-aqi.css';

const show = (value, unit = '') => value == null || !Number.isFinite(Number(value)) ? '—' : `${Math.round(Number(value) * 10) / 10}${unit}`;
const currentIndex = (current) => current?.openweather_index ?? current?.us_aqi ?? null;
const indexLabel = (current) => current?.openweather_index != null ? 'OpenWeather index · 1–5' : current?.us_aqi != null ? 'US AQI · 0–500' : 'AQI unavailable';

export default function AirQualityPage({ authorityMode = false } = {}) {
  const [query, setQuery] = useState('Lucknow, Uttar Pradesh');
  const [location, setLocation] = useState(null);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (latitude, longitude, label) => {
    setLoading(true); setError('');
    try {
      const data = await loadLocationAirQuality(latitude, longitude);
      setLocation({ latitude: Number(latitude), longitude: Number(longitude), label: label || `${Number(latitude).toFixed(4)}, ${Number(longitude).toFixed(4)}` });
      setReport(data);
      if (data?.status === 'unavailable' || currentIndex(data?.current) == null) setError(data?.note || 'No AQI index was returned for this location. Try another nearby area.');
    } catch (err) {
      setError(err?.message || 'Could not load air quality for this location.');
    } finally { setLoading(false); }
  }, []);

  const search = async (event) => {
    event?.preventDefault?.();
    const text = query.trim();
    if (!text) { setError('Enter a city, neighbourhood, or address.'); return; }
    setLoading(true); setError('');
    try {
      const response = await api.get(`/routing/geocode?q=${encodeURIComponent(text)}&limit=5`);
      const place = response?.results?.[0];
      if (!place) throw new Error(`No mapped place found for “${text}”. Try a nearby landmark or city name.`);
      setQuery(place.label || text);
      await load(place.latitude, place.longitude, place.label || text);
    } catch (err) { setError(err?.message || 'Could not find that location.'); setLoading(false); }
  };

  const useLocation = () => {
    if (!navigator.geolocation) { setError('Location access is not available in this browser.'); return; }
    setLocating(true); setError('');
    navigator.geolocation.getCurrentPosition(async ({ coords }) => {
      let label = 'Your current location';
      try { const place = await api.get(`/routing/reverse-geocode?latitude=${coords.latitude}&longitude=${coords.longitude}`); label = place.label || label; } catch { /* coordinates remain usable */ }
      setQuery(label); setLocating(false); load(coords.latitude, coords.longitude, label);
    }, (geoError) => { setLocating(false); setError(geoError.code === 1 ? 'Location permission was denied. You can search for a city instead.' : 'Could not retrieve your location. Check device location services and retry.'); }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
  };

  const current = report?.current || {};
  const index = currentIndex(current);
  const openWeatherScale = current.openweather_index != null;
  const forecast = (report?.forecast || []).filter((item) => currentIndex(item) != null).slice(0, 8);
  const category = current.category || 'AQI unavailable';
  const markers = location ? [{ id: 'air-quality-location', lat: location.latitude, lng: location.longitude, title: location.label, description: `${indexLabel(current)}: ${index == null ? '—' : Math.round(index)}`, kind: openWeatherScale ? (index >= 4 ? 'critical' : index >= 3 ? 'busy' : 'normal') : (index >= 151 ? 'critical' : index >= 101 ? 'busy' : 'normal') }] : [];

  return <div className="location-aqi-page air-quality-dashboard">
    <PageIntro eyebrow={authorityMode ? "CITY ENVIRONMENT" : "LOCAL CONDITIONS"} title={authorityMode ? "Air quality monitoring" : "Air quality"} description={authorityMode ? "Review the current provider AQI, pollutant readings and hourly outlook for a selected area." : "Check the AQI and pollutant readings for any location before heading out."} action={<button className="utility" type="button" onClick={() => location && load(location.latitude, location.longitude, location.label)} disabled={!location || loading}><RefreshCw size={14}/>{loading ? 'Updating…' : 'Refresh'}</button>} />
    <section className="panel air-search-panel">
      <form className="air-location-form" onSubmit={search}>
        <label htmlFor="air-location-query"><span className="eyebrow">SEARCH AREA</span><span className="air-location-input"><MapPin size={17}/><input id="air-location-query" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Enter city, neighbourhood, or address" autoComplete="off" /></span></label>
        <button className="primary" type="submit" disabled={loading}><Search size={15}/>{loading ? 'Checking…' : 'Check air quality'}</button>
        <button className="secondary" type="button" onClick={useLocation} disabled={locating || loading}><LocateFixed size={15}/>{locating ? 'Locating…' : 'Use my location'}</button>
      </form>
    </section>
    {error && <div className="aqi-location-notice"><AlertTriangle size={16}/><span>{error}</span><button type="button" onClick={() => location && load(location.latitude, location.longitude, location.label)}>Retry</button></div>}
    {report && <>
      <div className="air-quality-summary-grid">
        <section className="panel air-aqi-card"><div className="air-card-top"><span className="air-card-symbol"><Wind size={19}/></span><span className="air-status-pill">{report?.provider || 'AQI provider'}</span></div><div className="eyebrow">{indexLabel(current)}</div><strong className={`air-big-index ${index == null ? 'unavailable' : openWeatherScale ? index >= 4 ? 'high' : index >= 3 ? 'mid' : 'good' : index >= 151 ? 'high' : index >= 101 ? 'mid' : 'good'}`}>{index == null ? '—' : Math.round(index)}</strong><h3>{category}</h3><p>{location?.label}</p><div className="air-index-duo"><div><small>OpenWeather index</small><b>{current.openweather_index == null ? '—' : current.openweather_index}<i>/ 5</i></b></div><div><small>US AQI</small><b>{current.us_aqi == null ? '—' : Math.round(current.us_aqi)}<i>/ 500</i></b></div></div><div className="air-aqi-foot"><span><Clock3 size={13}/>{report?.updated_at ? new Date(report.updated_at).toLocaleString() : 'Provider time unavailable'}</span><span>{openWeatherScale ? 'Provider scale' : 'Forecast scale'}</span></div></section>
        <section className="panel air-pollutants-card"><div className="panel-head"><div><div className="eyebrow">POLLUTANT LEVELS</div><h3>What is in the air</h3></div><Activity size={18}/></div><div className="air-pollutants-grid"><div><small>PM2.5</small><b>{show(current.pm25, ' µg/m³')}</b><span>Fine particles</span></div><div><small>PM10</small><b>{show(current.pm10, ' µg/m³')}</b><span>Coarse particles</span></div><div><small>Ozone</small><b>{show(current.ozone, ' µg/m³')}</b><span>Ground-level O₃</span></div><div><small>Nitrogen dioxide</small><b>{show(current.nitrogen_dioxide, ' µg/m³')}</b><span>NO₂ concentration</span></div></div><div className="air-provider-note">{report?.note || 'Readings reflect the selected provider and forecast grid cell.'}</div></section>
      </div>
      <div className="air-quality-lower-grid"><section className="panel air-map-card"><div className="panel-head"><div><div className="eyebrow">LOCATION</div><h3>{location?.label || 'Selected area'}</h3></div><MapPin size={17}/></div><CityMap markers={markers} zoom={13} className="air-quality-map" /></section>
        <section className="panel air-hourly-card"><div className="panel-head"><div><div className="eyebrow">FORECAST</div><h3>Next hours</h3></div><span className="status-pill">{forecast.length} points</span></div>{forecast.length ? <div className="air-hourly-list">{forecast.map((item) => { const aqi = currentIndex(item); return <article key={item.time}><div><small>{new Date(item.time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</small><b>{item.category || 'AQI'}</b></div><strong>{Math.round(aqi)}</strong><span className={`air-index-track ${openWeatherScale ? 'scale-openweather' : ''}`}><i style={{ width: `${Math.max(5, Math.min(100, Number(aqi) / (openWeatherScale ? 5 : 300) * 100))}%` }} /></span></article>; })}</div> : <div className="air-hourly-empty">No hourly points returned for this location.</div>}<small className="air-source-foot">{report?.provider || 'Source unavailable'} · The forecast index scale is shown above each reading.</small></section></div>
    </>}
    {!report && !loading && <section className="panel air-empty-state"><span><Wind size={28}/></span><h3>Search a location to see its air quality</h3><p>Use a city or address, or share your location to load an available provider forecast.</p></section>}
  </div>;
}
