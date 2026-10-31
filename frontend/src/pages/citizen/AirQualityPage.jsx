import { useCallback, useState } from 'react';
import { Activity, AlertTriangle, Clock3, CloudSun, LocateFixed, MapPin, RefreshCw, Search, Wind } from 'lucide-react';
import PageIntro from '../../components/shared/PageIntro.jsx';
import CityMap from '../../components/maps/CityMap.jsx';
import { api } from '../../services/api/client.js';
import { loadLocationAirQuality } from '../../services/airQuality.js';
import { searchPublicPlaces } from '../../services/publicRouting.js';
import './location-aqi.css';

const show = (value, unit = '') => value == null || !Number.isFinite(Number(value)) ? '—' : `${Math.round(Number(value) * 10) / 10}${unit}`;
const currentIndex = (current) => current?.openweather_index ?? current?.us_aqi ?? null;
const indexLabel = (current) => current?.openweather_index != null ? 'OpenWeather index · 1–5' : current?.us_aqi != null ? 'US AQI · 0–500' : 'AQI unavailable';
const forecastIndex = (row = {}) => row.us_aqi ?? row.aqi ?? row.openweather_index ?? null;
const forecastCategory = (value) => value == null ? 'Unavailable' : value <= 50 ? 'Good' : value <= 100 ? 'Moderate' : value <= 150 ? 'Sensitive groups' : value <= 200 ? 'Unhealthy' : value <= 300 ? 'Very unhealthy' : 'Hazardous';

function AirQualityTrend({ rows }) {
  const values = rows.map((row) => Number(forecastIndex(row))).filter(Number.isFinite);
  if (values.length < 2) return <div className="air-aqi-chart-empty">Hourly forecast values are unavailable for this location.</div>;
  const min = Math.min(0, ...values);
  const max = Math.max(50, ...values);
  const points = values.map((value, index) => `${index / (values.length - 1) * 100},${90 - ((value - min) / Math.max(1, max - min)) * 78}`).join(' ');
  return <div className="air-aqi-chart"><svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="24 hour AQI forecast trend">{[20, 42, 64, 86].map((y) => <line key={y} x1="0" y1={y} x2="100" y2={y} className="air-aqi-chart-grid"/>)}<polyline points={points} className="air-aqi-chart-line"/></svg><div><span>Now</span><span>+6h</span><span>+12h</span><span>+18h</span><span>+24h</span></div></div>;
}

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
      let places = [];
      try {
        const response = await api.get(`/routing/geocode?q=${encodeURIComponent(text)}&limit=5`, { timeoutMs: 9000 });
        places = response?.results || [];
      } catch { /* direct public geocoder below */ }
      if (!places.length) places = await searchPublicPlaces(text, 5);
      const place = places[0];
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
  const category = current.category || 'AQI unavailable';
  const markers = location ? [{ id: 'air-quality-location', lat: location.latitude, lng: location.longitude, title: location.label, description: `${indexLabel(current)}: ${index == null ? '—' : Math.round(index)}`, kind: openWeatherScale ? (index >= 4 ? 'critical' : index >= 3 ? 'busy' : 'normal') : (index >= 151 ? 'critical' : index >= 101 ? 'busy' : 'normal') }] : [];
  const forecast = (report?.forecast || []).filter((row) => forecastIndex(row) != null).slice(0, 24);
  const forecastValues = forecast.map((row) => Number(forecastIndex(row))).filter(Number.isFinite);
  const forecastPeak = forecastValues.length ? Math.max(...forecastValues) : null;
  const forecastLow = forecastValues.length ? Math.min(...forecastValues) : null;
  const peakRow = forecast.find((row) => Number(forecastIndex(row)) === forecastPeak);

  return <div className="location-aqi-page air-quality-dashboard">
    <PageIntro eyebrow={authorityMode ? "CITY ENVIRONMENT" : "LOCAL CONDITIONS"} title={authorityMode ? "Air quality monitoring" : "Air quality"} description={authorityMode ? "Review current AQI, pollutant readings and the next 24 hours of forecast for a selected area." : "Check current AQI, pollutant levels and the next 24 hours of forecast for your chosen location."} action={<button className="utility" type="button" onClick={() => location && load(location.latitude, location.longitude, location.label)} disabled={!location || loading}><RefreshCw size={14}/>{loading ? 'Updating…' : 'Refresh'}</button>} />
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
      {forecast.length > 0 && <section className="air-aqi-outlook">
        <div className="air-aqi-outlook-header"><div><div className="eyebrow">NEXT 24 HOURS</div><h3>Air quality outlook</h3><p>Hourly forecast for {location?.label || 'the selected area'}.</p></div><span className="air-aqi-forecast-pill"><CloudSun size={14}/> Forecast grid</span></div>
        <div className="air-aqi-outlook-kpis"><article><span>24-hour peak</span><b>{show(forecastPeak)}</b><small>{peakRow?.time ? new Date(peakRow.time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'Forecast maximum'}</small></article><article><span>24-hour low</span><b>{show(forecastLow)}</b><small>Lowest forecast index</small></article><article><span>PM2.5 now</span><b>{show(current.pm25, ' µg/m³')}</b><small>Fine particles</small></article><article><span>PM10 now</span><b>{show(current.pm10, ' µg/m³')}</b><small>Coarse particles</small></article></div>
        <div className="air-aqi-outlook-grid"><article className="panel air-aqi-trend-panel"><div className="air-aqi-panel-heading"><div><span className="eyebrow">HOURLY TREND</span><h4>How AQI may change</h4></div><Activity size={18}/></div><AirQualityTrend rows={forecast}/><div className="air-aqi-trend-legend"><span><i/>Forecast AQI</span><small>{forecast.length} hourly points</small></div></article><article className="panel air-aqi-hourly-panel"><div className="air-aqi-panel-heading"><div><span className="eyebrow">FORECAST TIMELINE</span><h4>Hour by hour</h4></div><span>{forecast.length} points</span></div><div className="air-aqi-hourly-list">{forecast.map((row) => { const value = Number(forecastIndex(row)); return <div key={row.time}><time>{new Date(row.time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time><b>{show(value)}</b><span className={`air-aqi-hourly-band ${value <= 50 ? 'good' : value <= 100 ? 'moderate' : value <= 150 ? 'sensitive' : 'poor'}`}/><small>{forecastCategory(value)}</small><em>{show(row.pm25 ?? row.pm2_5, ' µg/m³')} PM2.5</em></div>; })}</div></article></div>
        <div className="air-aqi-forecast-note"><CloudSun size={15}/><span><b>Forecast, not a station reading.</b> Values represent a gridded atmospheric forecast. Nearby ground-station observations are shown separately in the authority AQI and IoT views.</span></div>
      </section>}
      <div className="air-quality-lower-grid air-quality-map-only"><section className="panel air-map-card"><div className="panel-head"><div><div className="eyebrow">LOCATION</div><h3>{location?.label || 'Selected area'}</h3></div><MapPin size={17}/></div><CityMap markers={markers} zoom={13} className="air-quality-map" /></section></div>
    </>}
    {!report && !loading && <section className="panel air-empty-state"><span><Wind size={28}/></span><h3>Search a location to see its air quality</h3><p>Use a city or address, or share your location to view current conditions and a 24-hour outlook together.</p></section>}
  </div>;
}
