import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, AlertTriangle, CarFront, Clock3, Gauge, LocateFixed, MapPin, Pause, Play, RefreshCw, Route, Search, ShieldCheck, TrendingUp } from 'lucide-react';
import PageIntro from '../../components/shared/PageIntro.jsx';
import TrafficSimulationScene from '../authority/TrafficSimulationScene.jsx';
import CityMap from '../../components/maps/CityMap.jsx';
import { api } from '../../services/api/client.js';
import './traffic-simulation.css';

const SCENARIO_KEY = 'urbansarthi.activeTrafficScenario';
const DEFAULT_POINT = { latitude: '28.6139', longitude: '77.2090', label: 'New Delhi' };
const SCENARIOS = {
  baseline: { label: 'Baseline traffic', multiplier: 1 },
  demand_surge: { label: 'Higher demand', multiplier: 1.45 },
  signal_priority: { label: 'Signal-priority sensitivity', multiplier: 0.72 },
};
const ROAD_NAMES = ['Ring Road · west', 'Connaught Place approach', 'ITO junction approach', 'NH-48 connector', 'Outer Ring Road', 'Janpath corridor', 'Airport Road', 'Old Delhi approach'];
const fmt = (value, suffix = '') => value === null || value === undefined || !Number.isFinite(Number(value)) ? '—' : `${Math.round(Number(value) * 10) / 10}${suffix}`;
const int = (value) => Number(value || 0).toLocaleString('en-IN');
const savedScenario = () => { try { const value = localStorage.getItem(SCENARIO_KEY); return SCENARIOS[value] ? value : 'baseline'; } catch { return 'baseline'; } };

// Only used when the simulation service is unreachable. It is explicitly tagged
// as reference data, and must never be presented as live traffic or an ML result.
function makeReferenceScenario(scenario) {
  const factor = SCENARIOS[scenario]?.multiplier ?? 1;
  const timeline = Array.from({ length: 13 }, (_, step) => {
    const roads = ROAD_NAMES.map((road, index) => {
      const baseline = 7 + ((index * 7 + 9) % 29);
      const queue = Math.max(0, Math.round(baseline * factor + step * (0.45 + (index % 4) * 0.18) * factor - (scenario === 'signal_priority' ? step * 0.12 : 0)));
      const vehicles = Math.round(queue * 1.35 + 5 + (index % 3) * 3);
      const level = queue >= 32 ? 'Heavy' : queue >= 18 ? 'Moderate' : 'Light';
      return { road, vehicles, queue, level };
    });
    return { minute: step * 5, roads, queue_total: roads.reduce((sum, road) => sum + road.queue, 0), heavy_roads: roads.filter((road) => road.level === 'Heavy').length };
  });
  return {
    mode: 'reference', summary: { road_count: ROAD_NAMES.length }, timeline,
    training_data: { records: 0, simulation_runs: 0, road_edges: ROAD_NAMES.length, minutes_per_run: 60 },
    models: {}, notes: ['The simulation service was unavailable. These road labels and values are illustrative reference patterns, not live observations or model predictions.'],
  };
}

function pickPlace(response, query) {
  const results = response?.results || [];
  if (!results.length) throw new Error(`No mapped place found for “${query}”. Try a landmark, locality, or full address.`);
  return results.find((item) => String(item.label).toLowerCase() === query.trim().toLowerCase()) || results[0];
}

export default function TrafficInfoPage({ adminMode = false }) {
  const [point, setPoint] = useState(DEFAULT_POINT);
  const [provider, setProvider] = useState(null);
  const [scenarioData, setScenarioData] = useState(null);
  const [scenario, setScenario] = useState(savedScenario);
  const [loading, setLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [frameIndex, setFrameIndex] = useState(0);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);
  const [searchMode, setSearchMode] = useState('location');
  const [locationQuery, setLocationQuery] = useState('New Delhi');
  const [originQuery, setOriginQuery] = useState('New Delhi Railway Station');
  const [destinationQuery, setDestinationQuery] = useState('India Gate');
  const [suggestions, setSuggestions] = useState({ location: [], origin: [], destination: [] });
  const [routeGeometry, setRouteGeometry] = useState([]);
  const [mapMarkers, setMapMarkers] = useState([{ id: 'traffic-location', lat: 28.6139, lng: 77.2090, title: 'New Delhi', description: 'Selected traffic area' }]);
  const [mappedRoute, setMappedRoute] = useState(null);
  const [searchBusy, setSearchBusy] = useState(false);
  const timerRef = useRef(null);
  const suggestTimer = useRef(null);

  const publishScenario = useCallback((next) => {
    setScenario(next);
    if (adminMode) {
      try { localStorage.setItem(SCENARIO_KEY, next); } catch { /* in-memory scenario still works */ }
      window.dispatchEvent(new CustomEvent('urbansarthi:traffic-scenario', { detail: { scenario: next, label: SCENARIOS[next]?.label } }));
    }
  }, [adminMode]);

  useEffect(() => {
    if (adminMode) return undefined;
    const sync = (event) => setScenario(event?.detail?.scenario || savedScenario());
    window.addEventListener('storage', sync);
    window.addEventListener('urbansarthi:traffic-scenario', sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener('urbansarthi:traffic-scenario', sync);
    };
  }, [adminMode]);

  const refresh = useCallback(async (overridePoint = point, overrideScenario = scenario) => {
    const latitude = Number(overridePoint.latitude), longitude = Number(overridePoint.longitude);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      setError('Enter a valid location or choose one from the suggestions.'); return;
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
      if (current?.flow == null) setError('No location-specific live speed feed is configured for this point. The network scenario is shown separately.');
    } catch (err) {
      setProvider(null);
      setScenarioData(makeReferenceScenario(overrideScenario));
      setFrameIndex(0); setPlaying(false); setLastUpdated(new Date().toISOString());
      setError(`${err?.message || 'The simulation service is unavailable.'} Showing clearly labelled reference road activity instead.`);
    } finally { setLoading(false); }
  }, [point, scenario]);

  useEffect(() => {
    const timer = window.setTimeout(() => refresh(point, scenario), 220);
    return () => window.clearTimeout(timer);
  }, [point.latitude, point.longitude, scenario, refresh]);

  useEffect(() => {
    if (!playing || !adminMode || !scenarioData?.timeline?.length) return undefined;
    timerRef.current = window.setInterval(() => setFrameIndex((current) => {
      const last = scenarioData.timeline.length - 1;
      if (current >= last) { setPlaying(false); return last; }
      return current + 1;
    }), 1000);
    return () => window.clearInterval(timerRef.current);
  }, [playing, adminMode, scenarioData]);

  useEffect(() => () => { window.clearTimeout(suggestTimer.current); window.clearInterval(timerRef.current); }, []);

  const requestSuggestions = (field, query) => {
    if (adminMode) return;
    window.clearTimeout(suggestTimer.current);
    if (query.trim().length < 2) { setSuggestions((old) => ({ ...old, [field]: [] })); return; }
    suggestTimer.current = window.setTimeout(async () => {
      try {
        const response = await api.get(`/routing/geocode?q=${encodeURIComponent(query.trim())}&limit=5`);
        setSuggestions((old) => ({ ...old, [field]: response.results || [] }));
      } catch { /* keep text search available if the geocoder is offline */ }
    }, 280);
  };

  const searchRoadActivity = async (event) => {
    event?.preventDefault?.();
    setSearchBusy(true); setError('');
    try {
      if (searchMode === 'location') {
        const query = locationQuery.trim();
        if (!query) throw new Error('Enter a place, neighbourhood, or address.');
        const selected = pickPlace(await api.get(`/routing/geocode?q=${encodeURIComponent(query)}&limit=5`), query);
        const nextPoint = { latitude: String(selected.latitude), longitude: String(selected.longitude), label: selected.label };
        setPoint(nextPoint); setLocationQuery(selected.label); setMappedRoute(null); setRouteGeometry([]);
        setMapMarkers([{ id: 'traffic-location', lat: Number(selected.latitude), lng: Number(selected.longitude), title: selected.label, description: 'Selected area for traffic lookup' }]);
        await refresh(nextPoint, scenario);
      } else {
        const from = originQuery.trim(), to = destinationQuery.trim();
        if (!from || !to) throw new Error('Enter both a starting point and destination.');
        const [origin, destination] = await Promise.all([
          api.get(`/routing/geocode?q=${encodeURIComponent(from)}&limit=5`).then((r) => pickPlace(r, from)),
          api.get(`/routing/geocode?q=${encodeURIComponent(to)}&limit=5`).then((r) => pickPlace(r, to)),
        ]);
        const nextPoint = { latitude: String(origin.latitude), longitude: String(origin.longitude), label: origin.label };
        setPoint(nextPoint); setOriginQuery(origin.label); setDestinationQuery(destination.label);
        setMapMarkers([
          { id: 'traffic-origin', lat: Number(origin.latitude), lng: Number(origin.longitude), title: origin.label, description: 'Route origin' },
          { id: 'traffic-destination', lat: Number(destination.latitude), lng: Number(destination.longitude), title: destination.label, description: 'Route destination', kind: 'critical' },
        ]);
        try {
          const trip = await api.post('/routing/plan', {
            origin_latitude: Number(origin.latitude), origin_longitude: Number(origin.longitude),
            destination_latitude: Number(destination.latitude), destination_longitude: Number(destination.longitude),
            origin_label: origin.label, destination_label: destination.label, preference: 'balanced', modes: ['driving'],
          });
          const route = trip?.routes?.[0];
          const geometry = route?.geometry?.coordinates?.map?.(([lon, lat]) => ({ lat, lng: lon })) || [];
          setRouteGeometry(geometry); setMappedRoute(route ? { label: route.label || 'Mapped route', distance: route.distance_meters, duration: route.duration_seconds, provider: route.provider } : null);
        } catch {
          setRouteGeometry([]); setMappedRoute({ label: 'Route endpoints mapped', provider: 'Route service unavailable' });
          setError('Route geometry was not returned, so the map shows the selected start and destination. Road activity below follows the authority-selected network scenario.');
        }
        await refresh(nextPoint, scenario);
      }
    } catch (err) { setError(err?.message || 'Could not look up that place. Try a nearby landmark or locality.'); }
    finally { setSearchBusy(false); }
  };

  const useCurrentLocation = () => {
    if (!navigator.geolocation) { setError('Location access is not supported by this browser.'); return; }
    setError(''); navigator.geolocation.getCurrentPosition(async ({ coords }) => {
      let label = 'Your current location';
      try { const reverse = await api.get(`/routing/reverse-geocode?latitude=${coords.latitude}&longitude=${coords.longitude}`); label = reverse.label || label; } catch { /* coordinates remain usable */ }
      const nextPoint = { latitude: coords.latitude.toFixed(6), longitude: coords.longitude.toFixed(6), label };
      setPoint(nextPoint); setLocationQuery(label); setSearchMode('location'); setMappedRoute(null); setRouteGeometry([]);
      setMapMarkers([{ id: 'traffic-location', lat: coords.latitude, lng: coords.longitude, title: label, description: 'Your selected location' }]);
      refresh(nextPoint, scenario);
    }, (geoError) => setError(geoError.code === 1 ? 'Location permission was denied. Allow access or search for a place.' : 'Could not get your current location.'), { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  };

  const timeline = scenarioData?.timeline || [];
  const frame = timeline[Math.min(frameIndex, Math.max(0, timeline.length - 1))] || null;
  const previousFrame = timeline[Math.max(0, frameIndex - 1)] || null;
  const roads = useMemo(() => [...(frame?.roads || [])].sort((a, b) => Number(b.queue || 0) - Number(a.queue || 0)), [frame]);
  const chartPoints = useMemo(() => {
    const data = timeline.slice(0, frameIndex + 1); if (data.length < 2) return '';
    const maxValue = Math.max(1, ...data.map((x) => Number(x.queue_total || 0)));
    return data.map((item, i) => `${(i / Math.max(data.length - 1, 1)) * 100},${96 - (Number(item.queue_total || 0) / maxValue) * 82}`).join(' ');
  }, [timeline, frameIndex]);
  const startPlayback = () => { if (!timeline.length) return; if (frameIndex >= timeline.length - 1) setFrameIndex(0); setPlaying(true); };
  const scenarioLabel = SCENARIOS[scenario]?.label || 'Baseline traffic';
  const mapRoute = routeGeometry.length > 1 ? routeGeometry : [];

  return <div className="traffic-info-page traffic-scenario-page">
    <PageIntro eyebrow={adminMode ? 'NETWORK OPERATIONS' : 'YOUR LOCAL ROAD CONDITIONS'} title={adminMode ? 'Traffic Simulation' : 'Traffic & road conditions'} description={adminMode ? 'Run a 60-minute what-if scenario and publish the selected scenario to the citizen road-activity view.' : 'Search a place or route to see a mapped journey and the road segments with the heaviest modelled queues.'} action={<button className="utility" onClick={() => refresh()} disabled={loading}><RefreshCw size={14}/>{loading ? 'Updating…' : 'Refresh outlook'}</button>} />

    {adminMode ? <section className="panel traffic-location-panel"><div className="traffic-info-heading"><span className="traffic-info-icon"><Activity size={18}/></span><div><h3>Simulation controls</h3><p>Scenario changes are shared with the citizen road-activity page in this browser.</p></div></div>
      <form className="traffic-coordinate-form" onSubmit={(event) => { event.preventDefault(); refresh(point, scenario); }}><label>Area latitude<input type="number" step="any" min="-90" max="90" value={point.latitude} onChange={(e) => setPoint((old) => ({ ...old, latitude: e.target.value }))} required /></label><label>Area longitude<input type="number" step="any" min="-180" max="180" value={point.longitude} onChange={(e) => setPoint((old) => ({ ...old, longitude: e.target.value }))} required /></label><label>What-if scenario<select value={scenario} onChange={(e) => publishScenario(e.target.value)}><option value="baseline">Baseline traffic</option><option value="demand_surge">Higher demand</option><option value="signal_priority">Signal-priority sensitivity</option></select></label><button className="primary" type="submit" disabled={loading}><Activity size={15}/>Run 60-minute simulation</button></form>
      <div className="traffic-scenario-note"><ShieldCheck size={15}/><span><b>Published scenario: {scenarioLabel}.</b> The citizen road-activity page reads this scenario and refreshes the road queue data. This does not command physical signal controllers.</span></div>
    </section> : <section className="panel traffic-location-panel"><div className="traffic-info-heading"><span className="traffic-info-icon"><MapPin size={18}/></span><div><h3>Find traffic near a place or along a route</h3><p>Suggestions appear while you type. The selected area refreshes the traffic data and map.</p></div><button className="utility" type="button" onClick={useCurrentLocation}><LocateFixed size={14}/>Use my location</button></div>
      <div className="route-pref-options traffic-search-tabs"><button type="button" className={searchMode === 'location' ? 'selected' : ''} onClick={() => setSearchMode('location')}><MapPin size={14}/>A location</button><button type="button" className={searchMode === 'route' ? 'selected' : ''} onClick={() => setSearchMode('route')}><Route size={14}/>A route</button></div>
      <form className="traffic-coordinate-form traffic-place-form" onSubmit={searchRoadActivity}>
        {searchMode === 'location' ? <label>Place, area, or address<input list="traffic-location-suggestions" value={locationQuery} onChange={(e) => { setLocationQuery(e.target.value); requestSuggestions('location', e.target.value); }} placeholder="e.g. Hazratganj, Lucknow" autoComplete="off"/><datalist id="traffic-location-suggestions">{suggestions.location.map((place) => <option key={place.place_id || place.label} value={place.label}/>)}</datalist></label> : <><label>Starting point<input list="traffic-origin-suggestions" value={originQuery} onChange={(e) => { setOriginQuery(e.target.value); requestSuggestions('origin', e.target.value); }} placeholder="Search start location" autoComplete="off"/><datalist id="traffic-origin-suggestions">{suggestions.origin.map((place) => <option key={place.place_id || place.label} value={place.label}/>)}</datalist></label><label>Destination<input list="traffic-destination-suggestions" value={destinationQuery} onChange={(e) => { setDestinationQuery(e.target.value); requestSuggestions('destination', e.target.value); }} placeholder="Search destination" autoComplete="off"/><datalist id="traffic-destination-suggestions">{suggestions.destination.map((place) => <option key={place.place_id || place.label} value={place.label}/>)}</datalist></label></>}
        <button className="primary" type="submit" disabled={searchBusy || loading}><Search size={15}/>{searchBusy ? 'Finding roads…' : 'Show map & road activity'}</button>
      </form>
      <div className="traffic-scenario-note"><Activity size={15}/><span>Authority-selected scenario: <b>{scenarioLabel}</b>. Road queue levels below follow that scenario. The model road labels may not map one-to-one to every street in your searched route.</span></div>
    </section>}

    {error && <div className="traffic-scenario-note"><AlertTriangle size={15}/><span>{error}</span></div>}
    {provider?.flow && <section className="traffic-provider-strip panel"><span className="traffic-provider-check"><Activity size={16}/></span><div><b>Road segment reading available</b><small>{provider.provider} · {point.latitude}, {point.longitude}</small></div><div className="traffic-provider-value"><small>Current speed</small><b>{fmt(provider.flow.current_speed_kmph, ' km/h')}</b></div><div className="traffic-provider-value"><small>Free flow</small><b>{fmt(provider.flow.free_flow_speed_kmph, ' km/h')}</b></div></section>}

    {!scenarioData && <section className="panel traffic-loading-panel"><Activity size={21}/><b>{loading ? 'Preparing road activity…' : 'Road activity unavailable'}</b><p>The app will show the configured network forecast when the simulation endpoint responds.</p></section>}
    {scenarioData && frame && <>
      {!adminMode && <section className="panel traffic-map-panel"><div className="panel-head"><div><div className="eyebrow">MAPPED AREA / ROUTE</div><h3>{mappedRoute ? `${originQuery} to ${destinationQuery}` : point.label}</h3></div><span className="status-pill">{mappedRoute ? 'Route search' : 'Location search'}</span></div><CityMap markers={mapMarkers} route={mapRoute} zoom={13} className="traffic-user-map"/><div className="map-foot"><span><MapPin size={13}/> Selected place and road route</span><small>Map tiles © OpenStreetMap</small></div>{mappedRoute && <div className="traffic-map-route-summary"><b>{mappedRoute.label}</b><span>{mappedRoute.distance == null ? 'Distance unavailable' : `${(mappedRoute.distance / 1000).toFixed(1)} km`}</span><span>{mappedRoute.duration == null ? 'Duration unavailable' : `${Math.round(mappedRoute.duration / 60)} min estimated`}</span><small>{mappedRoute.provider || 'Routing service'}</small></div>}</section>}

      {adminMode ? <><section className="traffic-scenario-hero panel"><div className="traffic-scenario-hero-top"><div><span className="traffic-live-label"><i/>{scenarioLabel.toUpperCase()}</span><h2>60-minute network forecast</h2><p>Playback advances one five-minute forecast snapshot each second.</p></div><span className="traffic-trained-label"><ShieldCheck size={13}/> {scenarioData.mode === 'reference' ? 'Reference scenario' : 'Network model result'}</span></div>
        <div className="traffic-scenario-kpis"><div><small>Simulated time</small><strong>{frame.minute}<em> / 60 min</em></strong></div><div><small>Total queued vehicles</small><strong>{int(frame.queue_total)}</strong><span>{previousFrame && frame.queue_total !== previousFrame.queue_total ? `${frame.queue_total > previousFrame.queue_total ? '+' : ''}${int(frame.queue_total - previousFrame.queue_total)} since last step` : 'Starting snapshot'}</span></div><div><small>Heavy roads</small><strong>{frame.heavy_roads}<em> / {scenarioData.summary.road_count}</em></strong><span>{fmt((frame.heavy_roads / Math.max(frame.roads.length, 1)) * 100, '%')} of modelled roads</span></div><div><small>Network queue change</small><strong>{fmt((frame.queue_total - timeline[0].queue_total) / Math.max(timeline[0].queue_total, 1) * 100, '%')}</strong><span>vs. minute 0</span></div></div>
        <div className="traffic-playback"><div className="traffic-playback-actions"><button type="button" className="primary" onClick={playing ? () => setPlaying(false) : startPlayback}>{playing ? <><Pause size={15}/>Pause playback</> : <><Play size={15}/>{frameIndex >= timeline.length - 1 ? 'Replay 60 minutes' : frameIndex > 0 ? 'Resume playback' : 'Play 60-minute forecast'}</>}</button><button type="button" className="utility" onClick={() => { setPlaying(false); setFrameIndex(0); }}><RefreshCw size={14}/>Reset</button><span>Selected time: {Math.min(60, frame.minute)} simulated minutes</span></div><input className="traffic-time-slider" type="range" min="0" max={timeline.length - 1} value={frameIndex} onChange={(e) => { setPlaying(false); setFrameIndex(Number(e.target.value)); }} aria-label="Forecast time"/><div className="traffic-time-labels"><span>Now</span><span>15 min</span><span>30 min</span><span>45 min</span><span>60 min</span></div><div className="traffic-forecast-chart"><svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Queue trend throughout the forecast"><polyline points={chartPoints || '0,70 100,70'} fill="none" stroke="currentColor" strokeWidth="2.4" vectorEffect="non-scaling-stroke"/></svg>{timeline.map((item, index) => <button key={item.minute} type="button" title={`${item.minute} min · ${item.queue_total} queued`} className={index === frameIndex ? 'active' : ''} style={{ left: `${index / Math.max(timeline.length - 1, 1) * 100}%` }} onClick={() => { setPlaying(false); setFrameIndex(index); }}><span>{item.minute}m</span></button>)}</div></div>
      </section>
      <TrafficSimulationScene roads={roads} frame={frame} scenario={scenario} playing={playing}/>
      {scenarioData.mode !== 'reference' && <div className="traffic-model-metrics"><section className="panel"><div><span className="eyebrow">TRAINING SET</span><h3>{int(scenarioData.training_data?.records)} records</h3><p>{scenarioData.training_data?.simulation_runs ?? '—'} SUMO runs · {scenarioData.training_data?.road_edges ?? '—'} road edges · {scenarioData.training_data?.minutes_per_run ?? '—'} minutes per run</p></div><span className="metric-icon"><CarFront size={18}/></span></section><section className="panel"><div><span className="eyebrow">30 MIN MODEL</span><h3>{fmt(scenarioData.models?.horizon_30?.level_accuracy_percent, '%')} level accuracy</h3><p>Held-out run evaluation · MAE {fmt(scenarioData.models?.horizon_30?.mae_vehicles)} vehicles</p></div><span className="metric-icon"><Gauge size={18}/></span></section><section className="panel"><div><span className="eyebrow">60 MIN MODEL</span><h3>{fmt(scenarioData.models?.horizon_60?.level_accuracy_percent, '%')} level accuracy</h3><p>Held-out run evaluation · MAE {fmt(scenarioData.models?.horizon_60?.mae_vehicles)} vehicles · R² {scenarioData.models?.horizon_60?.r2 == null ? '—' : Number(scenarioData.models.horizon_60.r2).toFixed(3)}</p></div><span className="metric-icon"><TrendingUp size={18}/></span></section></div>}
      <section className="panel traffic-model-disclaimer"><div className="eyebrow">FORECAST SCOPE</div><h3>{scenarioData.mode === 'reference' ? 'Reference network scenario' : 'Model-based network outlook'}</h3><p>{scenarioData.mode === 'reference' ? 'The simulation service could not be reached, so reference patterns are shown to keep the scenario controls and road activity visible. These values are illustrative and are not live traffic measurements or an ML prediction.' : 'The playback steps through the configured network forecast at five-minute intervals. The selected scenario is shared with the citizen road activity view; it does not command physical signal controllers.'}</p></section>
      </> : <section className="panel traffic-scenario-hero traffic-user-summary"><div className="traffic-scenario-hero-top"><div><span className="traffic-live-label"><i/>{scenarioLabel.toUpperCase()}</span><h2>Road activity forecast</h2><p>Current snapshot from the authority-selected 60-minute scenario.</p></div><span className="traffic-trained-label"><Clock3 size={13}/> Minute {frame.minute}</span></div><div className="traffic-scenario-kpis"><div><small>Queued vehicles</small><strong>{int(frame.queue_total)}</strong></div><div><small>Heavy roads</small><strong>{frame.heavy_roads}<em> / {scenarioData.summary.road_count}</em></strong></div><div><small>Highest queue</small><strong>{fmt(Math.max(0, ...roads.map((road) => Number(road.queue || 0))))}</strong><span>vehicles on one modelled segment</span></div><div><small>Scenario time</small><strong>{frame.minute}<em> / 60 min</em></strong></div></div><p className="api-note">{scenarioData.mode === 'reference' ? 'Reference activity is displayed because the simulation service is unavailable. It is illustrative, not live or a model prediction.' : 'This is a network-level scenario. A live, location-specific road segment feed is shown separately when the provider supports it.'}</p></section>}

      {adminMode && <section className="panel traffic-model-disclaimer"><div className="eyebrow">FORECAST SCOPE</div><h3>Review before operational use</h3><p>This is an analytical what-if simulation only. It does not change physical traffic signals. Road status is scenario data and may not correspond to an actual live street unless a road-level provider is connected.</p></section>}
      <section className="panel traffic-road-list"><div className="traffic-info-heading"><span className="traffic-info-icon"><Route size={18}/></span><div><h3>{adminMode ? `Road activity at minute ${frame.minute}` : 'Most congested modelled road segments'}</h3><p>{adminMode ? 'The selected frame updates queues and congestion classifications.' : 'Sorted by queued vehicles. These are network scenario labels; exact street matching depends on the connected road feed.'}</p></div><span className="status-pill">{roads.length} segments</span></div><div className="traffic-road-table"><div className="traffic-road-row traffic-road-header"><span>Road segment</span><span>Vehicle count</span><span>Queued vehicles</span><span>Congestion</span></div>{roads.slice(0, 18).map((road) => <div className="traffic-road-row" key={road.road}><b>{road.road}</b><span>{road.vehicles}</span><span>{fmt(road.queue)}</span><span className={`road-level ${String(road.level).toLowerCase()}`}>{road.level}</span></div>)}</div><p className="traffic-model-footnote">{(scenarioData.notes || []).join(' ')}</p></section>
      <section className="panel traffic-data-note"><h3>Data source status</h3><p>{provider?.flow ? `A provider road-flow snapshot is available from ${provider.provider} at your selected point. Scenario road activity is shown separately.` : scenarioData.mode === 'reference' ? 'Live road-speed readings and the simulation service are unavailable. Reference road activity remains visible with an explicit label.' : 'No location-specific live road-flow reading is available for this point. The road table represents the selected network scenario, not live camera observations on your street.'}</p><small>View updated {lastUpdated ? new Date(lastUpdated).toLocaleTimeString() : 'just now'} · Selected scenario: {scenarioLabel}</small></section>
    </>}
  </div>;
}
