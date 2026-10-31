import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, ArrowDownRight, ArrowUpRight, Clock3, CloudSun, MapPin, RefreshCw, Wind } from 'lucide-react';
import PageIntro from '../../components/shared/PageIntro.jsx';
import { loadLocationAirQuality } from '../../services/airQuality.js';
import '../../pages/authority/monitoring-pages.css';

const AREAS = {
  Lucknow: { label: 'Lucknow, Uttar Pradesh', lat: 26.8467, lon: 80.9462 },
  Kanpur: { label: 'Kanpur, Uttar Pradesh', lat: 26.4499, lon: 80.3319 },
  Delhi: { label: 'Delhi, NCR', lat: 28.6139, lon: 77.2090 },
  Mumbai: { label: 'Mumbai, Maharashtra', lat: 19.0760, lon: 72.8777 },
  Bengaluru: { label: 'Bengaluru, Karnataka', lat: 12.9716, lon: 77.5946 },
  Kolkata: { label: 'Kolkata, West Bengal', lat: 22.5726, lon: 88.3639 },
  Hyderabad: { label: 'Hyderabad, Telangana', lat: 17.3850, lon: 78.4867 },
  Pune: { label: 'Pune, Maharashtra', lat: 18.5204, lon: 73.8567 },
};
const fmt = (value, digits = 0) => value == null || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString('en-IN', { maximumFractionDigits: digits });
const aqiValue = (row = {}) => row.us_aqi ?? row.aqi ?? row.openweather_index ?? null;
const category = (value) => value == null ? 'Unavailable' : value <= 50 ? 'Good' : value <= 100 ? 'Moderate' : value <= 150 ? 'Sensitive groups' : value <= 200 ? 'Unhealthy' : value <= 300 ? 'Very unhealthy' : 'Hazardous';

function ForecastChart({ rows }) {
  const points = useMemo(() => {
    const values = rows.map((row) => Number(aqiValue(row))).filter(Number.isFinite);
    if (values.length < 2) return null;
    const min = Math.min(0, ...values);
    const max = Math.max(50, ...values);
    return values.map((value, index) => `${index / (values.length - 1) * 100},${89 - ((value - min) / Math.max(1, max - min)) * 76}`).join(' ');
  }, [rows]);
  if (!points) return <div className="aqi-forecast-chart-empty">Hourly index values are not available for this location.</div>;
  return <div className="aqi-forecast-chart"><svg viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Hourly AQI forecast chart">{[20, 42, 64, 86].map((y) => <line key={y} x1="0" y1={y} x2="100" y2={y} className="aqi-forecast-gridline"/>)}<polyline points={points} className="aqi-forecast-line"/></svg><div className="aqi-forecast-axis"><span>Now</span><span>+6h</span><span>+12h</span><span>+18h</span><span>+24h</span></div></div>;
}

export default function AqiForecastPage({ authorityMode = false }) {
  const [areaKey, setAreaKey] = useState('Lucknow');
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const area = AREAS[areaKey];
  const refresh = useCallback(async () => {
    setLoading(true); setError('');
    try { setReport(await loadLocationAirQuality(area.lat, area.lon)); }
    catch (err) { setError(err.message || 'Air-quality forecast is temporarily unavailable.'); }
    finally { setLoading(false); }
  }, [area.lat, area.lon]);
  useEffect(() => { refresh(); }, [refresh]);
  const rows = (report?.forecast || []).filter((row) => aqiValue(row) != null).slice(0, 24);
  const current = report?.current || {};
  const currentAqi = aqiValue(current);
  const values = rows.map((row) => Number(aqiValue(row))).filter(Number.isFinite);
  const peak = values.length ? Math.max(...values) : null;
  const low = values.length ? Math.min(...values) : null;
  const peakRow = rows.find((row) => Number(aqiValue(row)) === peak);
  const modeLabel = report?.provider === 'Open-Meteo Air Quality' ? 'Provider forecast' : 'Platform forecast';

  return <main className="monitor-page aqi-forecast-page">
    <PageIntro eyebrow={authorityMode ? 'CITY ENVIRONMENT · FORECAST' : 'PLAN AHEAD · AIR QUALITY'} title="AQI forecast" description={authorityMode ? 'Review the next 24 hours of forecast-grid air quality and pollutant movement for a selected city.' : 'See how air quality may change through the day and plan outdoor activity around the outlook.'} action={<><label className="area-select-wrap"><MapPin size={15}/><select value={areaKey} onChange={(event) => setAreaKey(event.target.value)}>{Object.entries(AREAS).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}</select></label><button className="monitor-button" onClick={refresh} disabled={loading}><RefreshCw size={14} className={loading ? 'monitor-spin' : ''}/>{loading ? 'Updating' : 'Refresh forecast'}</button></>} />
    {error && <div className="monitor-alert"><CloudSun size={15}/>{error}</div>}
    {report && <>
      <section className="aqi-forecast-hero"><div><span className="monitor-overline"><span className="status-pulse"/> {modeLabel.toUpperCase()} <i/> {area.label.toUpperCase()}</span><h2>Look ahead.<br/><em>Make healthier plans.</em></h2><p>{report.note || 'Hourly air-quality outlook for the selected forecast grid cell.'}</p><div className="aqi-forecast-meta"><span><Clock3 size={14}/>{report.updated_at ? `Updated ${new Date(report.updated_at).toLocaleString()}` : 'Update time unavailable'}</span><span><Activity size={14}/>{rows.length} hourly points</span></div></div><div className="aqi-forecast-current"><small>CURRENT AQI</small><strong>{fmt(currentAqi)}</strong><b>{category(currentAqi)}</b><span>{report.provider || 'Air-quality provider'}</span></div></section>
      <section className="aqi-forecast-kpis"><article><span>24-hour peak</span><strong>{fmt(peak)}</strong><small>{peakRow?.time ? new Date(peakRow.time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'Forecast maximum'}</small></article><article><span>24-hour low</span><strong>{fmt(low)}</strong><small>Lowest forecast index</small></article><article><span>PM2.5 now</span><strong>{fmt(current.pm25 ?? current.pm2_5, 1)} <i>µg/m³</i></strong><small>Fine particulate matter</small></article><article><span>PM10 now</span><strong>{fmt(current.pm10, 1)} <i>µg/m³</i></strong><small>Coarse particulate matter</small></article></section>
      <section className="monitor-grid aqi-forecast-main-grid"><article className="monitor-panel aqi-forecast-chart-panel"><div className="monitor-panel-heading"><div><span className="monitor-kicker">HOURLY OUTLOOK</span><h3>How AQI moves over 24 hours</h3><p>Forecast index by local hour. Higher values indicate poorer air quality.</p></div><Wind size={18}/></div><ForecastChart rows={rows}/></article><article className="monitor-panel aqi-forecast-hourly"><div className="monitor-panel-heading"><div><span className="monitor-kicker">FORECAST TIMELINE</span><h3>Hour by hour</h3><p>{area.label}</p></div><span className="monitor-live-badge">{rows.length} points</span></div><div className="aqi-forecast-hour-list">{rows.map((row) => { const value = aqiValue(row); return <div key={row.time}><span>{new Date(row.time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span><b>{fmt(value)}</b><i className={`aqi-forecast-band ${value <= 50 ? 'good' : value <= 100 ? 'moderate' : value <= 150 ? 'sensitive' : 'poor'}`}/><small>{category(value)}</small><em>{fmt(row.pm25 ?? row.pm2_5, 1)} PM2.5</em></div>; })}</div></article></section>
      <div className="aqi-forecast-source"><CloudSun size={15}/><span><b>Forecast, not a station reading.</b> The location forecast represents a gridded atmospheric model. Nearby ground-station observations are shown separately in the AQI overview and IoT network.</span></div>
    </>}
    {!report && !loading && !error && <section className="monitor-panel monitor-empty"><CloudSun size={22}/><b>Choose a city to view its forecast</b><span>The hourly outlook will appear here when a forecast provider responds.</span></section>}
  </main>;
}
