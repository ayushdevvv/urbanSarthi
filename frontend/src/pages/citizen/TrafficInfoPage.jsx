import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, AlertTriangle, CarFront, Clock3, Gauge, LocateFixed, MapPin, Pause, Play, RefreshCw, Route, ShieldCheck, TrendingUp } from 'lucide-react';
import PageIntro from '../../components/shared/PageIntro.jsx';
import { api } from '../../services/api/client.js';
import './traffic-simulation.css';

const DEFAULT_POINT = { latitude: '28.6139', longitude: '77.2090', label: 'New Delhi' };
const fmt = (value, suffix = '') => value === null || value === undefined || !Number.isFinite(Number(value)) ? '—' : `${Math.round(Number(value) * 10) / 10}${suffix}`;
const int = (value) => Number(value || 0).toLocaleString('en-IN');

export default function TrafficInfoPage() {
  const [point, setPoint] = useState(DEFAULT_POINT);
  const [provider, setProvider] = useState(null);
  const [scenarioData, setScenarioData] = useState(null);
  const [scenario, setScenario] = useState('baseline');
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [frameIndex, setFrameIndex] = useState(0);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);
  const timerRef = useRef(null);

  const refresh = useCallback(async (overridePoint = point, overrideScenario = scenario) => {
    const latitude = Number(overridePoint.latitude), longitude = Number(overridePoint.longitude);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      setError('Enter valid latitude and longitude values.'); return;
    }
    setLoading(true); setError('');
    const params = new URLSearchParams({ minutes: '60', step_minutes: '5', scenario: overrideScenario });
    try {
      const [current, timeline] = await Promise.all([
        api.get(`/traffic/current?latitude=${latitude}&longitude=${longitude}`).catch(() => null),
        api.get(`/traffic/simulation/scenario?${params.toString()}`),
      ]);
      setProvider(current?.flow ? current : null);
      setScenarioData(timeline); setFrameIndex(0); setPlaying(false); setLastUpdated(new Date().toISOString());
      if (current?.flow == null) setError('A traffic-aware live speed feed is not configured for this point. The trained network outlook is available below.');
    } catch (err) {
      setError(err?.message || 'Could not update the traffic outlook.');
      setScenarioData(null);
    } finally { setLoading(false); }
  }, [point, scenario]);

  useEffect(() => {
    const timer = window.setTimeout(() => refresh(point, scenario), 300);
    return () => window.clearTimeout(timer);
    // Automatic refresh follows every coordinate and scenario change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [point.latitude, point.longitude, scenario]);

  useEffect(() => {
    if (!playing || !scenarioData?.timeline?.length) return undefined;
    timerRef.current = window.setInterval(() => setFrameIndex((current) => {
      const finalIndex = scenarioData.timeline.length - 1;
      if (current >= finalIndex) { setPlaying(false); return finalIndex; }
      return current + 1;
    }), 1000);
    return () => window.clearInterval(timerRef.current);
  }, [playing, scenarioData]);

  const useCurrentLocation = () => {
    if (!navigator.geolocation) { setError('Location access is not supported by this browser.'); return; }
    setError(''); navigator.geolocation.getCurrentPosition(async ({ coords }) => {
      let label = 'Your current location';
      try { const reverse = await api.get(`/routing/reverse-geocode?latitude=${coords.latitude}&longitude=${coords.longitude}`); label = reverse.label || label; } catch { /* coordinates are still enough to refresh nearby provider data */ }
      setPoint({ latitude: coords.latitude.toFixed(6), longitude: coords.longitude.toFixed(6), label });
    }, (geoError) => setError(geoError.code === 1 ? 'Location permission was denied. Allow location access and retry.' : 'Could not get your current location.'), { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  };

  const timeline = scenarioData?.timeline || [];
  const frame = timeline[Math.min(frameIndex, Math.max(0, timeline.length - 1))] || null;
  const previousFrame = timeline[Math.max(0, frameIndex - 1)] || null;
  const roads = useMemo(() => [...(frame?.roads || [])].sort((a, b) => b.queue - a.queue), [frame]);
  const chartPoints = useMemo(() => {
    const data = timeline.slice(0, frameIndex + 1); if (data.length < 2) return '';
    const maxValue = Math.max(1, ...data.map((x) => x.queue_total));
    return data.map((item, i) => `${(i / Math.max(data.length - 1, 1)) * 100},${96 - (item.queue_total / maxValue) * 82}`).join(' ');
  }, [timeline, frameIndex]);
  const startPlayback = () => { if (!timeline.length) return; if (frameIndex >= timeline.length - 1) setFrameIndex(0); setPlaying(true); };

  return <div className="traffic-info-page traffic-scenario-page">
    <PageIntro eyebrow="NETWORK CONDITIONS" title="Traffic forecast" description="Explore a 60-minute traffic outlook across the modelled road network. Change your location to refresh any available provider road-flow readings." action={<button className="utility" onClick={() => refresh()} disabled={loading}><RefreshCw size={14}/>{loading ? 'Updating…' : 'Refresh outlook'}</button>} />
    <section className="panel traffic-location-panel"><div className="traffic-info-heading"><span className="traffic-info-icon"><MapPin size={18}/></span><div><h3>Location and scenario</h3><p>{point.label} · road network forecast is model-based; an exact live segment feed may not cover every location.</p></div><button className="utility" type="button" onClick={useCurrentLocation}><LocateFixed size={14}/>Use my location</button></div>
      <form className="traffic-coordinate-form" onSubmit={(event) => { event.preventDefault(); refresh(point, scenario); }}><label>Latitude<input type="number" step="any" min="-90" max="90" value={point.latitude} onChange={(e) => setPoint((old) => ({ ...old, latitude: e.target.value }))} required /></label><label>Longitude<input type="number" step="any" min="-180" max="180" value={point.longitude} onChange={(e) => setPoint((old) => ({ ...old, longitude: e.target.value }))} required /></label><label>What-if scenario<select value={scenario} onChange={(e) => setScenario(e.target.value)}><option value="baseline">Baseline traffic</option><option value="demand_surge">Higher demand</option><option value="signal_priority">Signal-priority sensitivity</option></select></label><button className="primary" type="submit" disabled={loading}><Activity size={15}/>Update forecast</button></form>
    </section>
    {error && <div className="traffic-scenario-note"><AlertTriangle size={15}/><span>{error}</span></div>}
    {provider?.flow && <section className="traffic-provider-strip panel"><span className="traffic-provider-check"><Activity size={16}/></span><div><b>Road segment reading available</b><small>{provider.provider} · {point.latitude}, {point.longitude}</small></div><div className="traffic-provider-value"><small>Current speed</small><b>{fmt(provider.flow.current_speed_kmph, ' km/h')}</b></div><div className="traffic-provider-value"><small>Free flow</small><b>{fmt(provider.flow.free_flow_speed_kmph, ' km/h')}</b></div></section>}
    {!scenarioData && <section className="panel traffic-loading-panel"><Activity size={21}/><b>{loading ? 'Preparing the 60-minute forecast…' : 'Forecast unavailable'}</b><p>The network model will appear here when the backend responds.</p></section>}
    {scenarioData && frame && <>
      <section className="traffic-scenario-hero panel"><div className="traffic-scenario-hero-top"><div><span className="traffic-live-label"><i/>{scenario === 'baseline' ? 'BASELINE OUTLOOK' : scenario === 'demand_surge' ? 'HIGHER-DEMAND OUTLOOK' : 'SIGNAL-PRIORITY WHAT-IF'}</span><h2>60-minute network forecast</h2><p>Playback advances one five-minute forecast snapshot each second.</p></div><span className="traffic-trained-label"><ShieldCheck size={13}/> Trained on SUMO runs</span></div>
        <div className="traffic-scenario-kpis"><div><small>Simulated time</small><strong>{frame.minute}<em> / 60 min</em></strong></div><div><small>Total queued vehicles</small><strong>{int(frame.queue_total)}</strong><span>{previousFrame && frame.queue_total !== previousFrame.queue_total ? `${frame.queue_total > previousFrame.queue_total ? '+' : ''}${int(frame.queue_total - previousFrame.queue_total)} since last step` : 'Starting snapshot'}</span></div><div><small>Heavy roads</small><strong>{frame.heavy_roads}<em> / {scenarioData.summary.road_count}</em></strong><span>{fmt((frame.heavy_roads / Math.max(frame.roads.length, 1)) * 100, '%')} of modelled roads</span></div><div><small>Network queue change</small><strong>{fmt((frame.queue_total - timeline[0].queue_total) / Math.max(timeline[0].queue_total, 1) * 100, '%')}</strong><span>vs. minute 0</span></div></div>
        <div className="traffic-playback"><div className="traffic-playback-actions"><button type="button" className="primary" onClick={playing ? () => setPlaying(false) : startPlayback}>{playing ? <><Pause size={15}/>Pause playback</> : <><Play size={15}/>{frameIndex >= timeline.length - 1 ? 'Replay 60 minutes' : frameIndex > 0 ? 'Resume playback' : 'Play 60-minute forecast'}</>}</button><button type="button" className="utility" onClick={() => { setPlaying(false); setFrameIndex(0); }}><RefreshCw size={14}/>Reset</button><span>Next update in real time: {Math.min(60, frame.minute)} simulated minutes</span></div><input className="traffic-time-slider" type="range" min="0" max={timeline.length - 1} value={frameIndex} onChange={(e) => { setPlaying(false); setFrameIndex(Number(e.target.value)); }} aria-label="Forecast time"/><div className="traffic-time-labels"><span>Now</span><span>15 min</span><span>30 min</span><span>45 min</span><span>60 min</span></div>
          <div className="traffic-forecast-chart"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Queue trend throughout the forecast"><polyline points={chartPoints || '0,70 100,70'} fill="none" stroke="currentColor" strokeWidth="2.4" vectorEffect="non-scaling-stroke"/></svg>{timeline.map((item, index) => <button key={item.minute} type="button" title={`${item.minute} min · ${item.queue_total} queued`} className={index === frameIndex ? 'active' : ''} style={{ left: `${index / Math.max(timeline.length - 1, 1) * 100}%` }} onClick={() => { setPlaying(false); setFrameIndex(index); }}><span>{item.minute}m</span></button>)}</div></div>
      </section>
      <div className="traffic-model-metrics"><section className="panel"><div><span className="eyebrow">TRAINING SET</span><h3>{int(scenarioData.training_data.records)} records</h3><p>{scenarioData.training_data.simulation_runs} SUMO runs · {scenarioData.training_data.road_edges} road edges · {scenarioData.training_data.minutes_per_run} minutes per run</p></div><span className="metric-icon"><CarFront size={18}/></span></section><section className="panel"><div><span className="eyebrow">30 MIN MODEL</span><h3>{fmt(scenarioData.models.horizon_30.level_accuracy_percent, '%')} level accuracy</h3><p>Held-out run evaluation · MAE {fmt(scenarioData.models.horizon_30.mae_vehicles)} vehicles</p></div><span className="metric-icon"><Gauge size={18}/></span></section><section className="panel"><div><span className="eyebrow">60 MIN MODEL</span><h3>{fmt(scenarioData.models.horizon_60.level_accuracy_percent, '%')} level accuracy</h3><p>Held-out run evaluation · MAE {fmt(scenarioData.models.horizon_60.mae_vehicles)} vehicles · R² {fmt(scenarioData.models.horizon_60.r2, 3)}</p></div><span className="metric-icon"><TrendingUp size={18}/></span></section></div>
      <section className="panel traffic-model-disclaimer"><div className="eyebrow">FORECAST SCOPE</div><h3>Model-based network outlook</h3><p>The playback steps through the trained forecasts at five-minute intervals. It uses the stored SUMO-generated road-network dataset; it is not a live road camera feed or a running SUMO/TraCI simulation. The selected coordinates refresh the available live provider lookup, while the bundled 80-edge model remains a separate network scenario.</p></section>
      <section className="panel traffic-road-list"><div className="traffic-info-heading"><span className="traffic-info-icon"><Route size={18}/></span><div><h3>Road segments at minute {frame.minute}</h3><p>Live playback updates road queues and congestion classifications on every step.</p></div><span className="status-pill">{roads.length} road segments</span></div><div className="traffic-road-table"><div className="traffic-road-row traffic-road-header"><span>Road segment</span><span>Vehicle count</span><span>Queued vehicles</span><span>Congestion</span></div>{roads.slice(0, 18).map((road) => <div className="traffic-road-row" key={road.road}><b>{road.road}</b><span>{road.vehicles}</span><span>{fmt(road.queue)}</span><span className={`road-level ${String(road.level).toLowerCase()}`}>{road.level}</span></div>)}</div><p className="traffic-model-footnote">{scenarioData.notes.join(' ')}</p></section>
      <section className="panel traffic-data-note"><h3>Model and provider status</h3><p>{provider?.flow ? `A provider road-flow snapshot is available from ${provider.provider} for your selected coordinates. The 60-minute road-network forecast is a separate model projection.` : 'No location-specific live road-flow feed is available for the selected coordinates. The trained road-network outlook remains available; it describes the SUMO-generated model network, not live camera observations on your street.'}</p><small>Forecast generated {lastUpdated ? new Date(lastUpdated).toLocaleTimeString() : 'just now'} · {scenarioData.training_data.records.toLocaleString('en-IN')} training records</small></section>
    </>}
  </div>;
}
