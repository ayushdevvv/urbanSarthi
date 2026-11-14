import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, CloudSun, MapPin, RefreshCw, RadioTower, Wind, Waves, Leaf, Camera, ChevronRight, Minus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../services/api/client.js';
import { loadLocationAirQuality } from '../../services/airQuality.js';
import PageIntro from '../../components/shared/PageIntro.jsx';
import PremiumLoadingScreen from '../../components/shared/PremiumLoadingScreen.jsx';
import './monitoring-pages.css';

const AREAS = {
  Lucknow: { label: 'Lucknow, Uttar Pradesh', lat: 26.8467, lon: 80.9462 },
  Kanpur: { label: 'Kanpur, Uttar Pradesh', lat: 26.4499, lon: 80.3319 },
  Delhi: { label: 'Delhi, NCR', lat: 28.6139, lon: 77.2090 },
  Mumbai: { label: 'Mumbai, Maharashtra', lat: 19.0760, lon: 72.8777 },
};
const fmt = (value, digits = 1) => value == null || !Number.isFinite(Number(value)) ? '—' : Number(value).toLocaleString(undefined, { maximumFractionDigits: digits });
const age = (value) => {
  if (!value) return 'Time unavailable';
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return 'Time unavailable';
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  return seconds < 60 ? 'Just now' : seconds < 3600 ? `${Math.floor(seconds / 60)} min ago` : `${Math.floor(seconds / 3600)} hr ago`;
};
function indexValue(current = {}) {
  if (current.us_aqi != null) return { value: Number(current.us_aqi), max: 500, scale: 'US AQI', unit: '/ 500' };
  if (current.openweather_index != null) return { value: Number(current.openweather_index), max: 5, scale: 'OpenWeather index', unit: '/ 5' };
  return { value: null, max: 500, scale: 'AQI unavailable', unit: '' };
}
function bandFor(value, max) {
  if (value == null) return { label: 'Awaiting readings', tone: 'neutral' };
  if (max === 5) return value <= 1 ? { label: 'Good', tone: 'good' } : value <= 2 ? { label: 'Fair', tone: 'good' } : value <= 3 ? { label: 'Moderate', tone: 'moderate' } : value <= 4 ? { label: 'Poor', tone: 'poor' } : { label: 'Very poor', tone: 'critical' };
  return value <= 50 ? { label: 'Good', tone: 'good' } : value <= 100 ? { label: 'Moderate', tone: 'moderate' } : value <= 150 ? { label: 'Sensitive groups', tone: 'moderate' } : value <= 200 ? { label: 'Unhealthy', tone: 'poor' } : value <= 300 ? { label: 'Very unhealthy', tone: 'critical' } : { label: 'Hazardous', tone: 'critical' };
}

// Bundled reference values are used only after a provider request fails.
// They are clearly distinguished from measured station readings.
const AIR_REFERENCE_PROFILES = {
  Lucknow: { aqi: 142, pm25: 53, pm10: 91, no2: 31, ozone: 42, stations: [139, 151, 128], hotspots: [86, 72, 61] },
  Kanpur: { aqi: 158, pm25: 61, pm10: 104, no2: 37, ozone: 39, stations: [154, 166, 147], hotspots: [89, 76, 64] },
  Delhi: { aqi: 184, pm25: 76, pm10: 132, no2: 44, ozone: 48, stations: [178, 192, 169], hotspots: [93, 82, 69] },
  Mumbai: { aqi: 96, pm25: 34, pm10: 67, no2: 22, ozone: 36, stations: [91, 103, 88], hotspots: [74, 63, 52] },
};
function makeReferenceAirReport(areaKey) {
  const profile = AIR_REFERENCE_PROFILES[areaKey] || AIR_REFERENCE_PROFILES.Lucknow;
  const start = new Date();
  start.setMinutes(0, 0, 0);
  const pattern = [0, -3, -6, -8, -5, 0, 5, 9, 12, 10, 7, 4, 1, -2, -5, -7, -4, 0, 4, 7, 5, 2, -1, -3];
  const forecast = pattern.map((offset, index) => {
    const us_aqi = Math.max(0, Math.min(500, Math.round(profile.aqi + offset)));
    const time = new Date(start.getTime() + index * 60 * 60 * 1000).toISOString();
    return { time, us_aqi, pm25: Number(Math.max(1, profile.pm25 + offset * 0.35).toFixed(1)), pm2_5: Number(Math.max(1, profile.pm25 + offset * 0.35).toFixed(1)), pm10: Number(Math.max(1, profile.pm10 + offset * 0.45).toFixed(1)), nitrogen_dioxide: profile.no2, ozone: profile.ozone, category: bandFor(us_aqi, 500).label };
  });
  return {
    status: 'reference_fallback', provider: 'UrbanSaarthi reference profile', forecast_provider: 'Reference outlook',
    forecast_is_reference: true, aqi_scale: 'US AQI 0–500',
    current: { us_aqi: profile.aqi, pm25: profile.pm25, pm2_5: profile.pm25, pm10: profile.pm10, nitrogen_dioxide: profile.no2, ozone: profile.ozone, category: bandFor(profile.aqi, 500).label },
    forecast, updated_at: null, _areaKey: areaKey,
    note: 'A reference profile is shown because the air-quality provider could not be reached. It is not a measured reading.',
    source: 'UrbanSaarthi reference dataset',
  };
}
function makeReferenceStations(areaKey) {
  const profile = AIR_REFERENCE_PROFILES[areaKey] || AIR_REFERENCE_PROFILES.Lucknow;
  return {
    status: 'reference_fallback', _areaKey: areaKey,
    stations: profile.stations.map((aqi, index) => ({
      distance_meters: [1800, 4200, 7600][index],
      station: { id: `${areaKey.toLowerCase()}-reference-${index + 1}`, station_name: `${areaKey} ${['Central', 'Transit corridor', 'Outer ring'][index]} reference station`, source: 'Reference profile', aqi, observed_at: null },
    })),
  };
}
function makeReferenceHotspots(areaKey) {
  const profile = AIR_REFERENCE_PROFILES[areaKey] || AIR_REFERENCE_PROFILES.Lucknow;
  return {
    status: 'reference_fallback', _areaKey: areaKey,
    items: profile.hotspots.map((hotspot_score, index) => ({
      junction_id: `${areaKey.toLowerCase()}-reference-j${index + 1}`,
      junction_name: `${areaKey} ${['Central junction', 'Market approach', 'Transit interchange'][index]} reference`,
      hotspot_score, ambient_air_quality: { category: 'Reference profile · not measured' }, data_quality: 'reference',
    })),
  };
}
function AqiDial({ value, max, tone, label = 'CURRENT AQI' }) {
  const progress = value == null ? 0 : Math.max(0, Math.min(1, value / max));
  const radius = 77;
  const circumference = 2 * Math.PI * radius;
  return <div className={`aqi-dial tone-${tone}`}>
    <svg viewBox="0 0 190 190" role="img" aria-label={`Air quality index ${value ?? 'unavailable'}`}>
      <circle cx="95" cy="95" r={radius} className="aqi-dial-track" />
      <circle cx="95" cy="95" r={radius} className="aqi-dial-progress" strokeDasharray={`${circumference * progress} ${circumference}`} transform="rotate(-90 95 95)" />
      <circle cx="95" cy="95" r="59" className="aqi-dial-inner" />
    </svg>
    <div className="aqi-dial-copy"><small>{label}</small><strong>{value == null ? '—' : Math.round(value)}</strong><span>{value == null ? 'No reading' : label.includes('REFERENCE') ? 'Reference index' : 'Current index'}</span></div>
  </div>;
}
function AqiForecastTrend({ rows, field, scaleLabel, scaleMax }) {
  const points = useMemo(() => {
    const valid = (rows || []).filter((row) => row?.[field] != null && Number.isFinite(Number(row[field])));
    if (valid.length < 2) return [];
    const values = valid.map((row) => Number(row[field]));
    const ceiling = scaleMax === 5 ? 5 : Math.max(100, Math.ceil(Math.max(...values) / 25) * 25);
    return valid.map((row, index) => ({
      x: 8 + index / (valid.length - 1) * 484,
      y: 126 - (Number(row[field]) / ceiling) * 98,
      value: Number(row[field]),
      time: row.time,
    }));
  }, [rows, field, scaleMax]);

  if (points.length < 2) return <div className="monitor-empty-chart"><Activity size={20}/><b>AQI forecast is preparing</b><span>Hourly AQI values will appear when the provider returns a forecast.</span></div>;
  const line = points.map((point) => `${point.x},${point.y}`).join(' ');
  const timeLabel = (value) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value || '').slice(11, 16) : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };
  return <div className="aqi-forecast-chart">
    <div className="aqi-forecast-chart-meta"><span><i/> {scaleLabel}</span><small>Hourly outlook · next 24 hours</small></div>
    <svg viewBox="0 0 500 150" preserveAspectRatio="none" role="img" aria-label={`${scaleLabel} hourly forecast trend`}>
      {[28, 58, 88, 118].map((y) => <line key={y} x1="5" x2="495" y1={y} y2={y} className="monitor-gridline"/>)}
      <polygon points={`8,136 ${line} 492,136`} className="monitor-chart-fill"/>
      <polyline points={line} className="monitor-chart-line"/>
      {points.filter((_, index) => index % Math.max(1, Math.floor(points.length / 5)) === 0).map((point, index) => <circle key={index} cx={point.x} cy={point.y} r="3.2" className="monitor-chart-point"><title>{`${timeLabel(point.time)} · ${fmt(point.value, 0)}`}</title></circle>)}
    </svg>
    <div className="chart-time-axis"><span>{timeLabel(points[0].time)}</span><span>Forecast window</span><span>{timeLabel(points.at(-1).time)}</span></div>
  </div>;
}

function Pollutant({ name, value, unit, limit, note }) {
  const pct = value == null ? 0 : Math.min(100, Math.max(3, Number(value) / limit * 100));
  return <article className="pollutant-card"><div className="pollutant-top"><span>{name}</span><b>{fmt(value, 1)} <small>{unit}</small></b></div><div className="pollutant-track"><i style={{ width: `${pct}%` }}/></div><small>{note}</small></article>;
}

export default function AirQualityOverviewPage({ forecastFocus = false }) {
  const [areaKey, setAreaKey] = useState('Lucknow');
  const [report, setReport] = useState(null);
  const [nearby, setNearby] = useState(null);
  const [hotspots, setHotspots] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestSequence = useRef(0);
  const area = AREAS[areaKey];
  const refresh = useCallback(async () => {
    const requestId = ++requestSequence.current;
    setLoading(true); setError('');
    const [airResult, stationResult, hotspotResult] = await Promise.allSettled([
      loadLocationAirQuality(area.lat, area.lon),
      api.get(`/aqi/nearby?latitude=${area.lat}&longitude=${area.lon}&radius_km=15`),
      api.get('/air-intelligence/hotspots?corridor_distance_km=0.5'),
    ]);
    if (requestId !== requestSequence.current) return;

    const failedSources = [];
    if (airResult.status === 'fulfilled' && airResult.value?.current) {
      setReport({ ...airResult.value, _areaKey: areaKey });
    } else {
      setReport(makeReferenceAirReport(areaKey));
      failedSources.push('air-quality forecast');
    }

    if (stationResult.status === 'fulfilled' && Array.isArray(stationResult.value?.stations)) {
      setNearby({ ...stationResult.value, _areaKey: areaKey });
    } else {
      setNearby(makeReferenceStations(areaKey));
      failedSources.push('sensor stations');
    }

    if (hotspotResult.status === 'fulfilled' && Array.isArray(hotspotResult.value?.items)) {
      setHotspots({ ...hotspotResult.value, _areaKey: areaKey });
    } else {
      setHotspots(makeReferenceHotspots(areaKey));
      failedSources.push('priority locations');
    }

    if (failedSources.length) {
      setError(`Could not refresh ${failedSources.join(', ')}. Reference values are active for the affected sections.`);
    }
    setLoading(false);
  }, [area.lat, area.lon, areaKey]);
  useEffect(() => { refresh(); }, [refresh]);

  const visibleReport = report?._areaKey === areaKey ? report : null;
  const nearbyData = nearby?._areaKey === areaKey ? nearby : null;
  const hotspotsData = hotspots?._areaKey === areaKey ? hotspots : null;
  const current = visibleReport?.current || {};
  const index = indexValue(current);
  const band = bandFor(index.value, index.max);
  const forecast = visibleReport?.forecast || [];
  const forecastField = forecast.some((row) => row?.us_aqi != null) ? 'us_aqi' : forecast.some((row) => row?.openweather_index != null) ? 'openweather_index' : null;
  const forecastRows = forecastField ? forecast.filter((row) => row?.[forecastField] != null && Number.isFinite(Number(row[forecastField]))) : [];
  const forecastValues = forecastRows.map((row) => Number(row[forecastField]));
  const peakForecast = forecastRows.length ? forecastRows.reduce((best, row) => Number(row[forecastField]) > Number(best[forecastField]) ? row : best) : null;
  const averageForecast = forecastValues.length ? forecastValues.reduce((sum, value) => sum + value, 0) / forecastValues.length : null;
  const forecastScaleMax = forecastField === 'openweather_index' ? 5 : 500;
  const forecastScaleLabel = forecastField === 'openweather_index' ? 'OpenWeather AQI · 1–5' : forecastField === 'us_aqi' ? 'US AQI · 0–500' : 'AQI scale pending';
  const matchingCurrentValue = forecastField === 'openweather_index' ? current.openweather_index : current.us_aqi;
  const forecastDelta = matchingCurrentValue != null && forecastValues.length ? forecastValues.at(-1) - Number(matchingCurrentValue) : null;
  const forecastDirection = forecastRows.length < 2 || forecastDelta == null ? 'unavailable' : Math.abs(forecastDelta) < (forecastScaleMax === 5 ? 0.25 : 5) ? 'steady' : forecastDelta > 0 ? 'rising' : 'easing';
  const stationRows = nearbyData?.stations || [];
  const hotspotRows = hotspotsData?.items || [];
  const referenceViewActive = visibleReport?.status === 'reference_fallback' || Boolean(visibleReport?.forecast_is_reference) || nearbyData?.status === 'reference_fallback' || hotspotsData?.status === 'reference_fallback';
  const updated = visibleReport?.updated_at || (!visibleReport?.forecast_is_reference ? forecast?.[0]?.time : null);
  const pollutants = [
    ['PM2.5', current.pm25 ?? current.pm2_5, 'µg/m³', 60, 'Fine particles'],
    ['PM10', current.pm10, 'µg/m³', 100, 'Coarse particles'],
    ['NO₂', current.nitrogen_dioxide, 'µg/m³', 80, 'Nitrogen dioxide'],
    ['O₃', current.ozone, 'µg/m³', 100, 'Ground-level ozone'],
  ];
  const sensorAverage = useMemo(() => {
    const values = stationRows.map((row) => row.station?.aqi).filter((n) => n != null && Number.isFinite(Number(n))).map(Number);
    return values.length ? values.reduce((sum, n) => sum + n, 0) / values.length : null;
  }, [stationRows]);

  const DirectionIcon = forecastDirection === 'rising' ? ArrowUpRight : forecastDirection === 'easing' ? ArrowDownRight : Minus;
  const peakBand = peakForecast ? bandFor(Number(peakForecast[forecastField]), forecastScaleMax).label : 'No peak available';
  if (loading) return <PremiumLoadingScreen title="Preparing AQI forecast" detail="Connecting to the selected city’s air-quality sources."/>;

  return <main className={`monitor-page air-overview-page ${forecastFocus ? 'forecast-focus' : ''}`}>
    <PageIntro eyebrow={forecastFocus ? 'AIR QUALITY / FORECAST' : 'AIR QUALITY'} title={forecastFocus ? 'AQI forecasting' : 'Air quality overview'} description={forecastFocus ? 'Review the next 24 hours of modelled air-quality conditions for the selected city.' : 'Air-quality conditions, hourly forecasts, pollutant levels and locations that need attention.'} action={<><label className="area-select-wrap"><MapPin size={15}/><select value={areaKey} onChange={(event) => setAreaKey(event.target.value)}>{Object.entries(AREAS).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}</select></label><button className="monitor-button" onClick={refresh} disabled={loading}><RefreshCw size={14} className={loading ? 'monitor-spin' : ''}/>{loading ? 'Updating' : 'Refresh'}</button></>} />
    {error && <div className="monitor-soft-notice" role="status"><AlertTriangle size={15}/><span>{error}</span></div>}
    {referenceViewActive && <div className="monitor-seed-notice" role="note"><Activity size={15}/><span><b>Reference profile active.</b> These values are not measured station readings or an official air-quality report.</span></div>}

    <section className="aqi-command-hero">
      <div className="aqi-hero-orbit orbit-a"/><div className="aqi-hero-orbit orbit-b"/><div className="aqi-hero-orbit orbit-c"/>
      <div className="aqi-hero-main">
        <div className="aqi-hero-copy"><div className="monitor-overline"><span className="status-pulse"/> CITY AIR OUTLOOK <i/> {area.label.toUpperCase()}</div>
          <h2>Understand the air.<br/><em>Act before it worsens.</em></h2>
          <p>Track the current air-quality outlook, identify rising pollutants and focus attention on affected corridors.</p>
          <div className="aqi-hero-meta"><span><CloudSun size={14}/>{visibleReport?.provider || 'Waiting for air-quality feed'}</span><span><Activity size={14}/>{updated ? `Updated ${age(updated)}` : 'No recent update'}</span></div>
        </div>
        <div className="aqi-hero-index"><AqiDial value={index.value} max={index.max} tone={band.tone} label={visibleReport?.status === 'reference_fallback' ? 'REFERENCE AQI' : 'CURRENT AQI'}/><div className={`aqi-status-label status-${band.tone}`}>{band.label}</div><small>{index.scale} · {index.unit || '—'}</small></div>
      </div>
      <div className="aqi-hero-bottom"><span><MapPin size={13}/>{area.label}</span><span>{visibleReport?.note || 'Forecast values are modelled outlooks. Ground-station observations are displayed separately below.'}</span></div>
    </section>

    <section className="monitor-kpis">
      <article className="monitor-kpi"><div className="kpi-icon green"><Wind size={17}/></div><span>PM2.5 concentration</span><strong>{fmt(current.pm25 ?? current.pm2_5)} <small>µg/m³</small></strong><em>Fine particulate matter</em></article>
      <article className="monitor-kpi"><div className="kpi-icon blue"><Waves size={17}/></div><span>{nearbyData?.status === 'reference_fallback' ? 'Station reference records' : 'Nearby sensor stations'}</span><strong>{stationRows.length}</strong><em>{nearbyData?.status === 'reference_fallback' ? 'Local reference profiles' : nearbyData?.status === 'available' ? 'Recent station observations' : 'No recent station observations'}</em></article>
      <article className="monitor-kpi"><div className="kpi-icon amber"><MapPin size={17}/></div><span>Priority hotspots</span><strong>{hotspotRows.length}</strong><em>Ranked from available traffic and air evidence</em></article>
      <article className="monitor-kpi"><div className="kpi-icon mint"><Leaf size={17}/></div><span>Station AQI average</span><strong>{fmt(sensorAverage, 0)}</strong><em>{nearbyData?.status === 'reference_fallback' ? 'Reference values · not measured' : 'Measured stations only · separate from forecast'}</em></article>
    </section>

    <section className="monitor-grid monitor-grid-primary">
      <article className="monitor-panel pollutant-panel"><div className="monitor-panel-heading"><div><span className="monitor-kicker">POLLUTANT PROFILE</span><h3>What is in the air?</h3><p>Each pollutant is shown in its own concentration unit.</p></div><span className="monitor-live-badge"><i/> {visibleReport?.status === 'reference_fallback' || visibleReport?.forecast_is_reference ? 'Reference outlook' : visibleReport?.status === 'available' || visibleReport?.status === 'provider_fallback' || visibleReport?.status === 'cached_provider' ? 'Outlook available' : visibleReport?.status === 'unavailable' ? 'Awaiting provider' : 'Awaiting feed'}</span></div><div className="pollutant-grid">{pollutants.map(([name, value, unit, limit, note]) => <Pollutant key={name} name={name} value={value} unit={unit} limit={limit} note={note}/>)}</div><div className="pollutant-footnote">Concentration indicators are not interchangeable with the overall AQI index.</div></article>
      <article className="monitor-panel aqi-forecast-panel" id="aqi-forecast"><div className="monitor-panel-heading"><div><span className="monitor-kicker">PREDICTIVE AIR INTELLIGENCE</span><h3>24-hour AQI forecast</h3><p>Hourly modelled AQI outlook for {area.label}.</p></div><div className="forecast-panel-actions">{forecastFocus ? <Link to="/authority/air-intelligence" className="monitor-text-link">Back to overview <ChevronRight size={14}/></Link> : <Link to="/authority/aqi-forecast" className="monitor-text-link">Full forecast <ChevronRight size={14}/></Link>}<span className="forecast-window-pill">24H OUTLOOK</span></div></div>
        <div className="aqi-forecast-summary">
          <article><span>Expected peak</span><strong>{fmt(peakForecast ? peakForecast[forecastField] : null, 0)}</strong><small>{peakForecast?.time ? `${new Date(peakForecast.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${peakBand}` : peakBand}</small></article>
          <article><span>24h average</span><strong>{fmt(averageForecast, 0)}</strong><small>{forecastScaleLabel}</small></article>
          <article className={`forecast-direction ${forecastDirection}`}><span>Outlook trend</span><strong><DirectionIcon size={17}/>{forecastDirection === 'rising' ? 'Rising' : forecastDirection === 'easing' ? 'Easing' : forecastDirection === 'steady' ? 'Steady' : 'Awaiting'}</strong><small>{forecastDelta == null ? 'Matched current + forecast values needed' : `${forecastDelta > 0 ? '+' : ''}${fmt(forecastDelta, 0)} over forecast window`}</small></article>
        </div>
        <AqiForecastTrend rows={forecastRows} field={forecastField || 'us_aqi'} scaleLabel={forecastScaleLabel} scaleMax={forecastScaleMax}/>
        <div className="trend-footer"><span>Valid forecast points <b>{forecastRows.length}</b></span><span>Source <b>{visibleReport?.forecast_provider || visibleReport?.provider || 'Awaiting data'}</b></span></div>
        <div className="aqi-forecast-footnote">Forecast values are model estimates, not ground-station measurements. US AQI (0–500) and OpenWeather index (1–5) are kept on separate scales.</div>
      </article>
    </section>

    <section className="monitor-grid monitor-grid-lower">
      <article className="monitor-panel"><div className="monitor-panel-heading"><div><span className="monitor-kicker">FIELD OBSERVATIONS</span><h3>Nearby sensor network</h3><p>{nearbyData?.status === 'reference_fallback' ? 'Station profiles are shown because the sensor feed could not be reached.' : 'Ground observations received by the platform within 15 km.'}</p></div><Link to="/authority/iot" className="monitor-text-link">Manage sensors <ChevronRight size={14}/></Link></div>
        {stationRows.length ? <div className="station-list">{stationRows.slice(0, 5).map((row) => { const station = row.station || {}; return <div className="station-row" key={station.id}><div className="station-marker"><RadioTower size={15}/></div><div className="station-info"><b>{station.station_name || 'Air sensor'}</b><small>{station.source || 'Sensor feed'} · {row.distance_meters != null ? `${(row.distance_meters / 1000).toFixed(1)} km away` : 'Distance unavailable'}</small></div><div className="station-measure"><b>{fmt(station.aqi, 0)}</b><small>AQI</small></div><span className="station-age">{age(station.observed_at)}</span></div>; })}</div> : <div className="monitor-empty"><RadioTower size={22}/><b>No recent sensor readings in this area</b><span>Connect an air-quality sensor or send a test observation to see it here.</span><Link to="/authority/iot">Open IoT network <ChevronRight size={14}/></Link></div>}
      </article>
      <article className="monitor-panel hotspot-panel"><div className="monitor-panel-heading"><div><span className="monitor-kicker">POLLUTION PRESSURE</span><h3>Priority locations</h3><p>{hotspotsData?.status === 'reference_fallback' ? 'A local priority shortlist is shown because the location feed could not be reached.' : 'Relative ranking from available traffic and air-quality evidence.'}</p></div><Link to="/authority/traffic" className="monitor-text-link">Traffic view <ChevronRight size={14}/></Link></div>
        {hotspotRows.length ? <div className="hotspot-list">{hotspotRows.slice(0, 4).map((item, index) => <div className="hotspot-row" key={item.junction_id || item.junction_name}><span className="hotspot-rank">0{index + 1}</span><div className="hotspot-details"><b>{item.junction_name}</b><small>{item.ambient_air_quality?.category || 'Ambient station data unavailable'} · {item.data_quality?.replaceAll('_', ' ') || 'Partial evidence'}</small><div className="hotspot-meter"><i style={{ width: `${Math.max(4, Number(item.hotspot_score || 0))}%` }}/></div></div><strong>{fmt(item.hotspot_score, 0)}</strong></div>)}</div> : <div className="monitor-empty compact"><MapPin size={20}/><b>No ranked locations yet</b><span>Hotspots appear after traffic observations are recorded.</span></div>}
        <small className="monitor-caveat">Scores are relative to the returned shortlist, not a regulatory pollution-risk scale. Reference scores are not measured risk values.</small>
      </article>
    </section>

    <section className="monitor-journeys"><Link to="/authority/carbon" className="monitor-journey-card"><span className="journey-icon"><Leaf size={18}/></span><div><b>Carbon & emissions</b><small>Estimate CO₂, NOx, PM and CO from observed traffic.</small></div><ChevronRight size={16}/></Link><Link to="/authority/traffic-lab" className="monitor-journey-card"><span className="journey-icon"><Camera size={18}/></span><div><b>Traffic intelligence</b><small>Analyze road footage and create an evidence report.</small></div><ChevronRight size={16}/></Link></section>
  </main>;
}
