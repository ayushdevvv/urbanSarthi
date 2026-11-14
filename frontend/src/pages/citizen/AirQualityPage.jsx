import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, AlertTriangle, Clock3, CloudSun, LocateFixed, MapPin, RefreshCw, Search, TrendingUp, Wind } from 'lucide-react';
import PageIntro from '../../components/shared/PageIntro.jsx';
import CityMap from '../../components/maps/CityMap.jsx';
import { api } from '../../services/api/client.js';
import { loadLocationAirQuality } from '../../services/airQuality.js';
import { searchPublicPlaces } from '../../services/publicRouting.js';
import './location-aqi.css';

const show = (value, unit = '') => value == null || !Number.isFinite(Number(value)) ? '—' : `${Math.round(Number(value) * 10) / 10}${unit}`;
const currentIndex = (current) => current?.us_aqi ?? current?.openweather_index ?? null;
const indexLabel = (current) => current?.us_aqi != null ? 'US AQI · 0–500' : current?.openweather_index != null ? 'OpenWeather index · 1–5' : 'AQI unavailable';
const forecastIndex = (row = {}) => row.us_aqi ?? row.aqi ?? row.openweather_index ?? null;
const forecastCategory = (row = {}) => {
  if (row.category) return row.category;
  const value = forecastIndex(row);
  if (value == null || !Number.isFinite(Number(value))) return 'Unavailable';
  if (row.openweather_index != null && row.us_aqi == null) return Number(value) <= 1 ? 'Good' : Number(value) <= 2 ? 'Fair' : Number(value) <= 3 ? 'Moderate' : Number(value) <= 4 ? 'Poor' : 'Very poor';
  return value <= 50 ? 'Good' : value <= 100 ? 'Moderate' : value <= 150 ? 'Sensitive groups' : value <= 200 ? 'Unhealthy' : value <= 300 ? 'Very unhealthy' : 'Hazardous';
};
const CITY_PRESETS = {
  lucknow: { label: 'Lucknow city centre, Uttar Pradesh', latitude: 26.8467, longitude: 80.9462 },
  kanpur: { label: 'Kanpur city centre, Uttar Pradesh', latitude: 26.4499, longitude: 80.3319 },
  delhi: { label: 'Delhi city centre, India', latitude: 28.6139, longitude: 77.2090 },
  mumbai: { label: 'Mumbai city centre, Maharashtra', latitude: 19.0760, longitude: 72.8777 },
};
const cityFallback = (query) => {
  const normalized = String(query || '').toLowerCase();
  const key = Object.keys(CITY_PRESETS).find((city) => new RegExp(`\\b${city}\\b`, 'i').test(normalized));
  return key ? CITY_PRESETS[key] : null;
};

const forecastBand = (row = {}) => {
  const category = forecastCategory(row).toLowerCase();
  if (category.includes('good')) return 'good';
  if (category.includes('fair') || category.includes('moderate')) return 'moderate';
  if (category.includes('sensitive')) return 'sensitive';
  if (category.includes('very')) return 'very-poor';
  return 'poor';
};

function AirQualityTrend({ rows }) {
  const values = rows.map((row) => Number(forecastIndex(row))).filter(Number.isFinite);
  if (values.length < 2) return <div className="air-aqi-chart-empty">A trend chart needs at least two forecast index values. The provider may still have current pollutant readings.</div>;
  const openWeatherScale = rows.length > 0 && rows.every((row) => row.openweather_index != null && row.us_aqi == null);
  const min = openWeatherScale ? 1 : Math.min(0, ...values);
  const max = openWeatherScale ? 5 : Math.max(50, ...values);
  const points = values.map((value, index) => `${index / (values.length - 1) * 100},${90 - ((value - min) / Math.max(1, max - min)) * 78}`).join(' ');
  const timeLabel = (value) => { const date = new Date(value); return Number.isNaN(date.getTime()) ? String(value || '').slice(11, 16) : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); };
  const labelIndexes = [...new Set([0, Math.floor((rows.length - 1) * .25), Math.round((rows.length - 1) * .5), Math.floor((rows.length - 1) * .75), rows.length - 1])];
  return <div className="air-aqi-chart"><svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="24 hour AQI forecast trend">{[20, 42, 64, 86].map((y) => <line key={y} x1="0" y1={y} x2="100" y2={y} className="air-aqi-chart-grid"/>)}<polyline points={points} className="air-aqi-chart-line"/></svg><div>{labelIndexes.map((index) => <span key={index}>{timeLabel(rows[index]?.time)}</span>)}</div></div>;
}

export default function AirQualityPage({ authorityMode = false, forecastFocus = false } = {}) {
  const [query, setQuery] = useState('Lucknow, Uttar Pradesh');
  const [location, setLocation] = useState(null);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState('');
  const autoLoadStarted = useRef(false);
  const requestSequence = useRef(0);

  const load = useCallback(async (latitude, longitude, label) => {
    const requestId = ++requestSequence.current;
    setLoading(true); setError('');
    try {
      const data = await loadLocationAirQuality(latitude, longitude);
      if (requestId !== requestSequence.current) return;
      setLocation({ latitude: Number(latitude), longitude: Number(longitude), label: label || `${Number(latitude).toFixed(4)}, ${Number(longitude).toFixed(4)}` });
      setReport(data);
      const hasForecastIndex = Array.isArray(data?.forecast) && data.forecast.some((row) => forecastIndex(row) != null);
      if (data?.status === 'unavailable' || (currentIndex(data?.current) == null && !hasForecastIndex)) setError(data?.note || 'No AQI index or forecast was returned for this location. Try another nearby area.');
    } catch (err) {
      if (requestId === requestSequence.current) setError(err?.message || 'Could not load air quality for this location.');
    } finally { if (requestId === requestSequence.current) setLoading(false); }
  }, []);

  const search = async (event) => {
    event?.preventDefault?.();
    const requestId = ++requestSequence.current;
    const text = query.trim();
    if (!text) { setError('Enter a city, neighbourhood, or address.'); return; }
    setLoading(true); setLocating(false); setError('');
    try {
      let places = [];
      try {
        const response = await api.get(`/routing/geocode?q=${encodeURIComponent(text)}&limit=5`, { timeoutMs: 9000 });
        places = response?.results || [];
      } catch { /* direct public geocoder below */ }
      if (!places.length) {
        try { places = await searchPublicPlaces(text, 5); } catch { places = []; }
      }
      if (requestId !== requestSequence.current) return;
      const place = places[0] || cityFallback(text);
      if (!place) throw new Error(`No mapped place found for “${text}”. Try a nearby landmark or city name.`);
      setQuery(place.label || text);
      await load(place.latitude, place.longitude, place.label || text);
    } catch (err) { if (requestId === requestSequence.current) { setError(err?.message || 'Could not find that location.'); setLoading(false); } }
  };

  const useLocation = () => {
    const requestId = ++requestSequence.current;
    setLoading(false);
    if (!navigator.geolocation) { setError('Location access is not available in this browser.'); return; }
    setLocating(true); setError('');
    navigator.geolocation.getCurrentPosition(async ({ coords }) => {
      if (requestId !== requestSequence.current) return;
      let label = 'Your current location';
      try { const place = await api.get(`/routing/reverse-geocode?latitude=${coords.latitude}&longitude=${coords.longitude}`); label = place.label || label; } catch { /* coordinates remain usable */ }
      if (requestId !== requestSequence.current) return;
      setQuery(label); setLocating(false); load(coords.latitude, coords.longitude, label);
    }, (geoError) => { if (requestId === requestSequence.current) { setLocating(false); setError(geoError.code === 1 ? 'Location permission was denied. You can search for a city instead.' : 'Could not retrieve your location. Check device location services and retry.'); } }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
  };

  useEffect(() => {
    if (autoLoadStarted.current) return;
    autoLoadStarted.current = true;
    // Load the default city on entry so citizens see an outlook immediately.
    // They can replace it with any city or their device location at any time.
    void search();
  }, []);

  const current = report?.current || {};
  const index = currentIndex(current);
  const openWeatherScale = current.us_aqi == null && current.openweather_index != null;
  const category = current.category || 'AQI unavailable';
  const markers = location ? [{ id: 'air-quality-location', lat: location.latitude, lng: location.longitude, title: location.label, description: `${indexLabel(current)}: ${index == null ? '—' : Math.round(index)}`, kind: openWeatherScale ? (index >= 4 ? 'critical' : index >= 3 ? 'busy' : 'normal') : (index >= 151 ? 'critical' : index >= 101 ? 'busy' : 'normal') }] : [];
  const forecast = (report?.forecast || []).filter((row) => forecastIndex(row) != null).slice(0, 24);
  const forecastValues = forecast.map((row) => Number(forecastIndex(row))).filter(Number.isFinite);
  const forecastPeak = forecastValues.length ? Math.max(...forecastValues) : null;
  const forecastLow = forecastValues.length ? Math.min(...forecastValues) : null;
  const forecastAverage = forecastValues.length ? forecastValues.reduce((sum, value) => sum + value, 0) / forecastValues.length : null;
  const peakRow = forecast.find((row) => Number(forecastIndex(row)) === forecastPeak);
  const forecastUsesOpenWeather = forecast.length > 0 && forecast.every((row) => row.openweather_index != null && row.us_aqi == null);
  const forecastScaleLabel = forecastUsesOpenWeather ? 'OpenWeather index · 1–5' : 'US AQI · 0–500';
  const forecastIntervalMinutes = forecast.length > 1 ? Math.round((new Date(forecast[1].time).getTime() - new Date(forecast[0].time).getTime()) / 60000) : null;
  const forecastIntervalLabel = forecastIntervalMinutes === 180 ? '3-hour intervals' : forecastIntervalMinutes === 60 ? 'Hourly forecast' : 'Provider forecast';

  return <div className="location-aqi-page air-quality-dashboard">
    <PageIntro eyebrow={authorityMode ? "CITY ENVIRONMENT" : forecastFocus ? "PERSONAL AIR OUTLOOK" : "LOCAL CONDITIONS"} title={authorityMode ? "Air quality monitoring" : forecastFocus ? "24-hour AQI forecast" : "Air quality"} description={authorityMode ? "Review current AQI, pollutant readings and the next 24 hours of forecast for a selected area." : forecastFocus ? "See how air quality may change through the day, compare forecast highs and lows, and check pollutant levels for your area." : "Check current AQI, pollutant levels and the next 24 hours of forecast for your chosen location."} action={<button className="utility" type="button" onClick={() => location && load(location.latitude, location.longitude, location.label)} disabled={!location || loading}><RefreshCw size={14}/>{loading ? 'Updating…' : 'Refresh'}</button>} />
    <section className="panel air-search-panel">
      <form className="air-location-form" onSubmit={search}>
        <label htmlFor="air-location-query"><span className="eyebrow">SEARCH AREA</span><span className="air-location-input"><MapPin size={17}/><input id="air-location-query" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Enter city, neighbourhood, or address" autoComplete="off" /></span></label>
        <button className="primary" type="submit" disabled={loading}><Search size={15}/>{loading ? 'Checking…' : 'Check air quality'}</button>
        <button className="secondary" type="button" onClick={useLocation} disabled={locating || loading}><LocateFixed size={15}/>{locating ? 'Locating…' : 'Use my location'}</button>
      </form>
    </section>
    {error && <div className="aqi-location-notice"><AlertTriangle size={16}/><span>{error}</span><button type="button" onClick={() => location && load(location.latitude, location.longitude, location.label)}>Retry</button></div>}
    {report && <>
      <div className={`air-quality-body ${forecastFocus ? 'forecast-first' : ''}`}>
      <div className="air-quality-summary-grid">
        <section className="panel air-aqi-card"><div className="air-card-top"><span className="air-card-symbol"><Wind size={19}/></span><span className="air-status-pill">{report?.provider || 'AQI provider'}</span></div><div className="eyebrow">{indexLabel(current)}</div><strong className={`air-big-index ${index == null ? 'unavailable' : openWeatherScale ? index >= 4 ? 'high' : index >= 3 ? 'mid' : 'good' : index >= 151 ? 'high' : index >= 101 ? 'mid' : 'good'}`}>{index == null ? '—' : Math.round(index)}</strong><h3>{category}</h3><p>{location?.label}</p><div className="air-index-duo"><div><small>OpenWeather index</small><b>{current.openweather_index == null ? '—' : current.openweather_index}<i>/ 5</i></b></div><div><small>US AQI</small><b>{current.us_aqi == null ? '—' : Math.round(current.us_aqi)}<i>/ 500</i></b></div></div><div className="air-aqi-foot"><span><Clock3 size={13}/>{report?.updated_at ? new Date(report.updated_at).toLocaleString() : 'Provider time unavailable'}</span><span>{openWeatherScale ? 'Provider scale' : 'Forecast scale'}</span></div></section>
        <section className="panel air-pollutants-card"><div className="panel-head"><div><div className="eyebrow">POLLUTANT LEVELS</div><h3>What is in the air</h3></div><Activity size={18}/></div><div className="air-pollutants-grid"><div><small>PM2.5</small><b>{show(current.pm25, ' µg/m³')}</b><span>Fine particles</span></div><div><small>PM10</small><b>{show(current.pm10, ' µg/m³')}</b><span>Coarse particles</span></div><div><small>Ozone</small><b>{show(current.ozone, ' µg/m³')}</b><span>Ground-level O₃</span></div><div><small>Nitrogen dioxide</small><b>{show(current.nitrogen_dioxide, ' µg/m³')}</b><span>NO₂ concentration</span></div></div><div className="air-provider-note">{report?.note || 'Readings reflect the selected provider and forecast grid cell.'}</div></section>
      </div>
      {forecast.length > 0 && <section className="air-aqi-outlook">
        <div className="air-aqi-outlook-header"><div><div className="eyebrow">NEXT 24 HOURS</div><h3>Air quality outlook</h3><p>{forecastIntervalLabel} for {location?.label || 'the selected area'}.</p></div><span className="air-aqi-forecast-pill"><CloudSun size={14}/> {forecastScaleLabel}</span></div>
        <div className="air-aqi-outlook-kpis"><article><span>24-hour peak</span><b>{show(forecastPeak)}</b><small>{peakRow?.time ? `${forecastCategory(peakRow)} · ${new Date(peakRow.time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Forecast maximum'}</small></article><article><span>24-hour low</span><b>{show(forecastLow)}</b><small>Lowest forecast index</small></article><article><span>24-hour average</span><b>{show(forecastAverage)}</b><small>{forecastScaleLabel}</small></article><article><span>Forecast coverage</span><b>{forecast.length}</b><small>{forecastIntervalLabel.toLowerCase()} · data points</small></article></div>
        <div className="air-aqi-outlook-grid"><article className="panel air-aqi-trend-panel"><div className="air-aqi-panel-heading"><div><span className="eyebrow">NEXT 24 HOURS</span><h4>How air quality may change</h4></div><Activity size={18}/></div><AirQualityTrend rows={forecast}/><div className="air-aqi-trend-legend"><span><i/>Forecast index</span><small>{forecast.length} forecast points · {forecastIntervalLabel.toLowerCase()}</small></div></article><article className="panel air-aqi-hourly-panel"><div className="air-aqi-panel-heading"><div><span className="eyebrow">FORECAST TIMELINE</span><h4>{forecastIntervalMinutes === 180 ? 'Every three hours' : 'Hour by hour'}</h4></div><span>{forecast.length} points</span></div><div className="air-aqi-hourly-list">{forecast.map((row) => { const value = Number(forecastIndex(row)); return <div key={row.time}><time>{new Date(row.time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time><b>{show(value)}</b><span className={`air-aqi-hourly-band ${forecastBand(row)}`}/><small>{forecastCategory(row)}</small><em>{show(row.pm25 ?? row.pm2_5, ' µg/m³')} PM2.5</em></div>; })}</div></article></div>
        <div className="air-aqi-forecast-note"><CloudSun size={15}/><span><b>Forecast, not a station reading.</b> Values represent a gridded atmospheric forecast. Nearby ground-station observations are shown separately in the authority AQI and IoT views.</span></div>
      </section>}
      {forecast.length === 0 && <section className="panel air-aqi-forecast-unavailable"><div className="air-aqi-panel-heading"><div><span className="eyebrow">24-HOUR OUTLOOK</span><h4>Forecast data is not available yet</h4></div><CloudSun size={18}/></div><p>The current provider returned no usable AQI index timeline for this location. Current pollutant readings remain separate; no forecast values are being generated or substituted.</p><button className="secondary" type="button" onClick={() => location && load(location.latitude, location.longitude, location.label)} disabled={loading}><RefreshCw size={14}/>Retry forecast</button></section>}
      <div className="air-quality-lower-grid air-quality-map-only"><section className="panel air-map-card"><div className="panel-head"><div><div className="eyebrow">LOCATION</div><h3>{location?.label || 'Selected area'}</h3></div><MapPin size={17}/></div><CityMap markers={markers} zoom={13} className="air-quality-map" /></section></div>
      </div>
    </>}
    {!report && loading && <section className="panel air-empty-state air-loading-state" role="status" aria-live="polite"><span><TrendingUp size={28}/></span><h3>Preparing your 24-hour AQI outlook</h3><p>Checking the selected location and retrieving current conditions plus forecast data.</p><div className="air-loading-track"><i/></div></section>}
    {!report && !loading && <section className="panel air-empty-state"><span><Wind size={28}/></span><h3>{forecastFocus ? 'Search a location to see its AQI forecast' : 'Search a location to see its air quality'}</h3><p>Use a city or address, or share your location to view current conditions and a 24-hour outlook together.</p></section>}
  </div>;
}
